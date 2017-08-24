const _ = require('highland');
const level = require('level');
const { hiddenStates } = require('./hidden-states.js');
const Immutable = require('immutable');

function maxPath(arrayOfPaths) {
  return arrayOfPaths
  // sort desc, path: { label, seq, prob }
  .sort((a, b) => b.cumulativeProb - a.cumulativeProb)[0];
}

function zeroOnError(err, push) {
  if (err.notFound) {
    push(null, 0);
  } else {
    push(err);
  }
}

function largeOnError(err, push) {
  if (err.notFound) {
    push(null, 1007199254740991);
  } else {
    push(err);
  }
}

function ngramCounts({ ngrams, previousStep }) {
  console.log(previousStep)
  const get = _.wrapCallback(ngrams.get.bind(ngrams));
  //console.log(previousStepStates)
  return function (token) {
    const { word } = token;
    return get(`uni\x00${word}`)
    .errors(zeroOnError)
    .map(cnt => parseFloat(cnt, 10))
    .flatMap(unigramCount =>
      _(previousStep.entrySeq())
      //.tap(_.log)
      .flatMap(([prevWord, { seq, cumulativeProb }]) =>
        get(`uni\x00${prevWord}`)
        .errors(largeOnError)
        .flatMap(unigramCountPrev => get(`bi\x00${prevWord}\x00${word}`)
          .errors(zeroOnError)
          .map(cnt => ({
            cumulativeProb,
            seq: [].concat(seq).concat(token),
            label: word,
            bigramCount: parseFloat(cnt, 10),
            unigramCount,
            unigramCountPrev,
            prevWord,
          }))
        )
      )
    );
  };
}


function mostLikelySequenceToCandidate(group) {
  if (Object.keys(group).length === 0) {
    throw new Error('empty candidate list in next step');
  }
  return Object.keys(group)
  .map(key => group[key])
  .map(arrayOfPaths => maxPath(arrayOfPaths))
  // map the js Map initialiser
  .map(({ label, seq, cumulativeProb }) => [label, { seq, cumulativeProb }]);
}

function throwIfNotBetweenZeroAndOne(value, name) {
  if (value < 0 || value > 1) {
    throw new Error(`${name} is not between zero and one (inclusive)`);
  }
}

function calculateProbs(stream) {
  return stream
  .tap((array) => { process.stdout.write(`lengte van candidaten lijst ${array.length}\n`); })
  .flatMap((arrayOfCandidates) => {
    // plus one (a half) smooting
    const smoothArrayOfCandidates = arrayOfCandidates
      .map(
        ({ cumulativeProb, seq, label, bigramCount, unigramCount, unigramCountPrev, prevWord }) =>
        ({ cumulativeProb,
          seq,
          label,
          bigramCount: bigramCount + 0.5,
          unigramCount: unigramCount + 0.5,
          unigramCountPrev,
          prevWord,
        })
      )
      // transitionProbsFromCounts
      .map(
        ({ cumulativeProb, seq, label, bigramCount, unigramCount, unigramCountPrev, prevWord }) =>
        ({ cumulativeProb,
          seq,
          label,
          bigramCount,
          unigramCount,
          unigramCountPrev,
          prevWord,
          transitionProb: bigramCount / unigramCountPrev,
        })
      );
    const [sumUni, sumTrans] = smoothArrayOfCandidates.reduce(
      ([uni, trans], { transitionProb, unigramCount }) =>
        [uni + unigramCount, trans + transitionProb],
      [0, 0]
    );

    // normalise to sum of probs of one
    const normalised = smoothArrayOfCandidates.map(
      ({ cumulativeProb, seq, label, unigramCount, prevWord, transitionProb }) => {
        const tProb = transitionProb / sumTrans;
        const eProb = unigramCount / sumUni;
        const cProb = cumulativeProb * tProb * eProb;
        throwIfNotBetweenZeroAndOne(tProb, 'transition probability');
        throwIfNotBetweenZeroAndOne(eProb, 'emission probability');

        //process.stdout.write(`${prevWord} ${label} T ${transitionProb} ${sumTrans} ${tProb} E ${unigramCount} ${sumUni} ${eProb} C ${cumulativeProb} ${cProb}\n`);
        if (isNaN(cProb) || cProb === 0) {
          throw new Error(`cumulative Prop is not a number
            ${prevWord} ${label} T ${transitionProb} ${sumTrans} ${tProb} E ${unigramCount} ${sumUni} ${eProb} C ${cumulativeProb} ${cProb}\n`);
        }
        return { label, seq, cumulativeProb: cProb };
      }
    );
    // normalise cumulative prob to one
    const sumOfCumulativeProb = normalised.reduce((acc, { cumulativeProb }) =>
      acc + cumulativeProb, 0);

    const normalisedCumulativeProb = normalised.map(
      ({ label, seq, cumulativeProb }) => {
        const p = cumulativeProb / sumOfCumulativeProb;
        throwIfNotBetweenZeroAndOne(p, 'cumulative probability');
        return { label, seq, cumulativeProb: p };
      }
    );

    return normalisedCumulativeProb;
  });
}

// calculate the next state for the next word in the sentence
// the previousStep contains the optimal sequence and probabilty
// for each hidden state for the previous word
function nextStep({ hidden, ngrams, previousStep, token: {
    word,
    paragraphNumber,
    sentenceNumber,
    wordNumber,
  } }) {
  // const previousStepStates = [...previousStep.entries()]
  //   .sort(([, a], [, b]) => b.cumulativeProb - a.cumulativeProb)
  //   .slice(-20);
  return hidden(word)
  // get bigram counts
  .map(candidate => ({ word: candidate, paragraphNumber, sentenceNumber, wordNumber }))
  .flatMap(ngramCounts({ ngrams, previousStep }))
  .collect()
  // calculate the combined probability previous * transition * emission
  .through(calculateProbs)
  // group all candidate transitions by possible translation in the new step
  .group('label')
  // select the most likely sequence for each possible translation
  // for the current word
  .map(mostLikelySequenceToCandidate)
  // create the new previous step
  .map(mapInitializer => Immutable.Map(mapInitializer))
  .tap(_.log);
}


// group all the words in the same sentence in an array
function groupWordsInTheirSentence(stream) {
  let prevParagraph = 1; // init at first to avoid emit of empty first sentence
  let prevSentence = 1;
  let sentence = [];
  return stream
  .map(({ key, value }) => {
    // `${keyPrefix}\x00${pad(paragraphNumber)}\x00${pad(sentenceNumber)}\x00${pad(wordNumber)}`
    const [, paragraphNumber, sentenceNumber, wordNumber] = key.split('\x00');
    return {
      paragraphNumber: parseInt(paragraphNumber, 10),
      sentenceNumber: parseInt(sentenceNumber, 10),
      wordNumber: parseInt(wordNumber, 10),
      word: value,
    };
  })
  .consume((err, x, push, next) => {
    if (err) {
      push(err);
      next();
    } else if (x === _.nil) {
      push(null, sentence);
      push(null, x);
    } else {
      const { paragraphNumber, sentenceNumber } = x;
      // there could be two paragraphs with one sentence
      if (prevSentence === sentenceNumber && prevParagraph === paragraphNumber) {
        sentence.push(x);
      } else {
        push(null, sentence);
        sentence = [x];
      }
      prevSentence = sentenceNumber;
      prevParagraph = paragraphNumber;
      next();
    }
  });
}

// // go through an array of the words in an sentence applying viterbi generating
// // the hidden states for each step as you go through the sentence
// // using some trickery to allow for an async reduction function
// function stepThroughSentence({ hidden, ngrams }) {
//   // we get an array containing the sentence objects
//   const doNextStep = nextStep({ hidden, ngrams });
//   return array => _(array)
//     .reduce(
//       (step, token) =>
//         step.flatMap(previous => doNextStep(previous, token)),
//       // we do not use an end of sentence marker as it will always be . ! or ?
//       _([new Map([['<S>', { cumulativeProb: 1, seq: [] }]])])
//     )
//     .sequence();
// }

function stepThroughSentence({ hidden, ngrams }) {
  return function (array) {
    let state = _([Immutable.Map({ '<S>': Immutable.Map({ cumulativeProb: 1, seq: Immutable.List() }) })]);
    return _(array).consume((err, x, push, next) => {
      if (x === _.nil) {
        next(state);
      } else if (err) {
        push(err);
        next();
      } else {
        try {
          state = state.flatMap(step =>
            nextStep({ hidden, ngrams, previousStep: step, token: x })
          );
        } catch (e) {
          push(e);
          push(null, _.nill);
          return;
        }
        next();
      }
    });
  };
}

function sentenceToString(array) {
  return array.map(token => token.word).join(' ');
}

function printSentence(array) {
  process.stdout.write(`${sentenceToString(array)}\n`);
}

function translate({ textName, vocabName, ngramsName }) {
  const vocab = level(`./db/${vocabName}`);
  const text = level(`./db/${textName}`);
  const ngrams = level(`./db/${ngramsName}`);
  const hidden = hiddenStates({ vocab });
  const translateSentence = stepThroughSentence({ hidden, ngrams });

  _(text.createReadStream({
    gte: 'txt\x00',
    lte: 'txt\x00\xff',
  }))
  .through(groupWordsInTheirSentence)
  .tap(printSentence)
  .flatMap(translateSentence)
  .map((step) => {
    if (step.size > 1) {
      throw new Error(`sentence did not terminate in a step with a single sequece ${step.toString()}`);
    }
    return step.values().next().value.seq;
  })
  .tap(printSentence)
  .done(() => {});
  //.through(storeTranslation)
  //.pipe(fs.createWriteStream(outputFilename));
}


module.exports = {
  maxPath,
  translate,
  nextStep,
  groupWordsInTheirSentence,
};

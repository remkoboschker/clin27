const Immutable = require('immutable');
const levenshtein = require('automata').lev();
const fs = require('fs');

/*
  type Token
    word,
    prevTranslation,
    prevUnigramCount,
    prevCumulativeProb
    translation,
    levenshteinDistance,
    unigramCount,
    bigramCount,
    emissionProb,
    transmissionProb,
    cumulativeProb,
    sentence,
*/

module.exports = function Translator({
  textDb,
  vocabDb,
  ngramsDb,
  lexiconDb,
  vocabName,
  ngramName,
  textName,
  levSum,
  changeIfInDict,
  altProb,
}) {
  // Error, string -> throws
  function throwError(e, name) {
    const err = new Error(e);
    err.name = name;
    throw err;
  }

  // opts -> token -> promise<token>
  function BigramCount({ ngrams }) {
    return async function bigramCount(token) {
      return new Promise((resolve, reject) => {
        ngrams.get(`bi\x00${token.get('prevTranslation')}\x00${token.get('translation')}`, (err, val) => {
          if (err) {
            if (err.notFound) {
              resolve(token.set('bigramCount', 0.5));
            } else {
              reject(err);
            }
          }
          resolve(token.set('bigramCount', parseInt(val, 10)));
        });
      });
    };
  }

  // opts -> token -> token -> promise<token>
  function UnigramCount({ ngrams }) {
    return async function unigramCount(token) {
      return new Promise((resolve, reject) => {
        ngrams.get(`uni\x00${token.get('translation')}`, (err, val) => {
          if (err) {
            if (err.notFound) {
              resolve(token.set('unigramCount', 0.5));
            } else {
              reject(err);
            }
          }
          resolve(token.set('unigramCount', parseInt(val, 10)));
        });
      });
    };
  }

  function InLexicon({ lexicon }) {
    return async function inLexicon(token) {
      return new Promise((resolve, reject) => {
        const word = token.get('word');
        lexicon.get(`${word}`, async (err, val) => {
          if (err) {
            if (err.notFound) {
              resolve(null);
            } else {
              reject(err);
            }
          }
          resolve(val);
        });
      });
    };
  }

  // obj -> map -> promise<list<map>>
  function PossibleTranslations({ inLexicon, vocab, scaleDistance, preprocessWord }) {
    function singleTranslation(token, translation, inVocabulary) {
      return Promise.resolve(
        Immutable.List([
          token.merge({
            translation,
            levenshteinDistance: 0,
            inVocabulary,
          }),
        ]));
    }
    return async function possibleTranslations(token) {
      let alts = Immutable.List();
      const word = token.get('word');
      const inVocabulary = token.get('inVocab');

      // punctuation will not be altered by translation
      if (!/[a-z]+/.test(word)) {
        return singleTranslation(token, word, inVocabulary);
      }

      // syn -> zijn
      if (word === 'syn' || word === 'zyn') {
        return singleTranslation(token, 'zijn', inVocabulary);
      }
      // 't -> 't
      if (word === '\'t') {
        return singleTranslation(token, '\'t', inVocabulary);
      }
      // enz -> enz
      if (word === 'enz') {
        return singleTranslation(token, 'enz', inVocabulary);
      }
      // der -> van_de
      if (word === 'der') {
        return singleTranslation(token, 'van_de', inVocabulary);
      }
      // des -> van_het
      if (word === 'des') {
        return singleTranslation(token, 'van_het', inVocabulary);
      }
      // gelijk -> zoals
      if (word === 'gelijk') {
        return singleTranslation(token, 'zoals', inVocabulary);
      }
      // soo -> dus
      if (word === 'soo') {
        return singleTranslation(token, 'dus', inVocabulary);
      }
      // hare -> hun
      if (word === 'hare') {
        return singleTranslation(token, 'hun', inVocabulary);
      }
      // welke -> die
      if (word === 'welke') {
        return singleTranslation(token, 'die', inVocabulary);
      }

      // by -> bij
      if (word === 'by') {
        return singleTranslation(token, 'bij', inVocabulary);
      }

      const lex = await inLexicon(token);

      if (lex !== null) {
        return singleTranslation(token, lex, inVocabulary);
      }

      if (!changeIfInDict && inVocabulary) {
        return singleTranslation(token, word, inVocabulary);
      }

      return new Promise((resolve, reject) => {
        vocab.createKeyStream({
          gte: 'uni\x00',
          lte: 'uni\x00\xff',
        })
        .on('data', (data) => {
          const alt = data.split('\x00')[1];
          const { pass, distance } = levenshtein.match({
            max: scaleDistance(word),
            strToMatch: preprocessWord(word),
            str: alt,
            caseSensitive: false,
          });

          // TODO fix return mode object and distance > max in automata.lev

          if (pass) {
            alts = alts.push(token.merge({
              translation: alt,
              levenshteinDistance: distance,
              inVocabulary,
            }));
          }
        })
        .on('end', () => {
          if (alts.size === 0) {
            process.stdout.write('no alts match\n');
            // if nothing is found return the word as its translation
            resolve(Immutable.List([
              token.merge({
                translation: word,
                levenshteinDistance: scaleDistance(word), // max distance
                inVocabulary,
              }),
            ]));
          }
          resolve(alts);
        })
        .on('error', err => reject(err));
      });
    };
  }

  // list<token> -> string -> list<token>
  function normalisedProbs(tokens, propName) {
    const sum = tokens.reduce((acc, val) => acc + val.get(propName), 0);
    return tokens.map((t) => {
      const normalised = t.get(propName) / sum;
      if (normalised < 0 || normalised > 1) {
        throw new Error(`normalised prob ${normalised} for ${t.get('translation')} with ${t.get(propName)} and total ${sum} out of range`);
      }
      return t.set(propName, normalised);
    });
  }

  // opts -> list<token> -> list<token>
  function EmissionProbs({ unigramCount }) {
    return async function emissionProbs(tokens) {
      const withEmissionProbsArray = await Promise.all(
        tokens.map((async (token) => {
          let withEmissionProb;
          try {
            const withUniCnt = await unigramCount(token);
            // if lev 0 then emissionProb = uniCnt
            const emissionProb =
              withUniCnt.get('unigramCount') / (withUniCnt.get('levenshteinDistance') + levSum);
            if (isNaN(emissionProb)) {
              throw new Error(`${token.get('word')} unigramCount ${withUniCnt.get('unigramCount')} / ( levenshteinDistance ${withUniCnt.get('levenshteinDistance')} + 1) is not a number`);
            }
            withEmissionProb = withUniCnt.set('emissionProb', emissionProb);
          } catch (e) {
            throwError(e, 'calling unigramCount');
          }
          return withEmissionProb;
        })));
      return normalisedProbs(Immutable.List(withEmissionProbsArray), 'emissionProb');
    };
  }

  function maximumPath(tokens) {
    const sumBigram = tokens.reduce((acc, val) => acc + val.get('bigramCount'), 0);
    return tokens
    .map((token) => {
      let transitionProb;
      if (sumBigram === 0 || isNaN(sumBigram)) {
        throw new Error(`${sumBigram} is zero or not a number`);
      }
      if (altProb) {
        transitionProb = token.get('bigramCount') / sumBigram;
      } else {
        transitionProb = token.get('bigramCount') / token.get('prevUnigramCount');
      }
      if (isNaN(transitionProb)) {
        throw new Error(`${token.get('word')} bigramCount ${token.get('bigramCount')} / prev unigramCount ${token.get('prevUnigramCount')} is not a number`);
      }
      return token.set('transitionProb', transitionProb);
    })
    .map((token) => {
      const cumulativeProb =
        token.get('prevCumulativeProb')
        * token.get('emissionProb')
        * token.get('transitionProb');
      if (isNaN(cumulativeProb)) {
        throw new Error(`${token.get('word')} prevCumulativeProb ${token.get('prevCumulativeProb')} * emissionProb ${token.get('emissionProb')} * transitionProb ${token.get('transitionProb')} is not a number`);
      }
      return token.set('cumulativeProb', cumulativeProb);
    })
    .maxBy(token => token.get('cumulativeProb'));
  }

  function printToken(token) {
    return `${token.get('paragraphNumber')}\t${token.get('sentenceNumber')}\t${token.get('wordNumber')}\t${token.get('word')}\t${token.get('inVocabulary')}\t${token.get('goldTranslation')}\t${token.get('translation')}\t${token.get('levenshteinDistance')}\t${token.get('unigramCount')}\t${token.get('prevTranslation')}\t${token.get('prevUnigramCount')}\t${token.get('prevCumulativeProb')}\t${token.get('bigramCount')}\t${token.get('goldTranslation') === token.get('translation')}\n`;
  }

  // opts -> list<token> -> list<token> -> promise<array<token>>
  function AllPaths({ bigramCount }) {
    return async function allPaths(prevTokens, token) {
      return Promise.all(prevTokens.map((async (prevToken) => {
        let withBigramCount;
        const tokenAfterPrevToken = token.merge({
          prevTranslation: prevToken.get('translation'),
          sentence: prevToken.get('sentence').push(token.get('translation')),
          prevUnigramCount: prevToken.get('unigramCount'),
          prevCumulativeProb: prevToken.get('cumulativeProb'),
        });
        try {
          withBigramCount = await bigramCount(tokenAfterPrevToken);
        } catch (e) {
          throwError(e, 'calling bigramCount');
        }
        // process.stdout.write(printToken(withBigramCount));
        return withBigramCount;
      })));
    };
  }

  // opts -> list<token> -> list<token> -> promise<list<token>>
  function MaximumPathToEachPossibleTranslation({ allPaths, maxPath }) {
    const translations = fs.createWriteStream(`./results/${new Date().toISOString()}-${textName}-${vocabName}-${ngramName}-levSum-${levSum}-changeIfInDict-${changeIfInDict}-altProb-${altProb}.csv`);
    return async function maximumPathToEachPossibleTranslation(prevTokens, tokens) {
      return Promise.all(
        tokens.map((async (token) => {
          const tokenArray = await allPaths(prevTokens, token);
          return Immutable.List(tokenArray);
        }))
      ).then(toks => toks.map((paths) => {
        const max = maxPath(paths);
        translations.write(printToken(max));
        return max;
      }));
    };
  }

  // opts -> list<token> -> token -> list<token>
  function TranslateWord({
    possibleTranslations,
    emissionProbs,
    maximumPathToEachPossibleTranslation,
  }) {
    return async function translateWord(token, prevTokens) {
      // paragraph token translates to an extra end of line
      try {
        const withPossibleTranslations = await possibleTranslations(token);
        const withEmissionProbs = await emissionProbs(withPossibleTranslations);
        const withMaximumPathToEachPossibleTranslationArray =
          await maximumPathToEachPossibleTranslation(prevTokens, withEmissionProbs);
        const withMaximumPathToEachPossibleTranslation =
          Immutable.List(withMaximumPathToEachPossibleTranslationArray);
        return normalisedProbs(withMaximumPathToEachPossibleTranslation, 'cumulativeProb');
      } catch (e) {
        throw new Error(e);
      }
    };
  }

  function TranslateSentence({ translateWord }) {
    return async function translateSentence(sentence, prevTokens) {
      const token = sentence.first();
      let tokens; // possible translations

      if (sentence.size === 0) {
        return prevTokens;
      }

      try {
        tokens = await translateWord(token, prevTokens);
      } catch (e) {
        throwError(e, 'calling translateWord');
      }
      return await translateSentence(sentence.shift(), tokens);
    };
  }

  function TranslateText({ translateSentence, startOfSentenceMarker }) {
    const translated = fs.createWriteStream(`./results/${new Date().toISOString()}-${textName}-${vocabName}-${ngramName}-levSum-${levSum}-changeIfInDict-${changeIfInDict}-altProb-${altProb}.txt`);
    return async function translateText(text, translation) {
      const sentence = text.first();
      let translatedSentence;

      if (text.size === 0) {
        return translation;
      }

      try {
        const lastPrevTokens = await translateSentence(sentence, startOfSentenceMarker);
        // kan gebeuren als zin niet eindigt met een leesteken
        if (lastPrevTokens.size > 1) {
          process.stdout.write('lastPrevTokens.size > 1');
          translatedSentence = lastPrevTokens.maxBy(token => token.get('cumulativeProb')).get('sentence');
        } else {
          translatedSentence = lastPrevTokens.first().get('sentence');
        }
        translated.write(`${translatedSentence.join(' ')}\n`);
      } catch (e) {
        throwError(e, 'calling translateSentence');
      }
      return await translateText(text.shift(), translation.push(translatedSentence));
    };
  }

  async function translate() {
    // const inVocab = InVocab({ vocab: vocabDb });
    const possibleTranslations = PossibleTranslations({
      inLexicon: InLexicon({ lexicon: lexiconDb }),
      vocab: vocabDb,
      scaleDistance: word => Math.ceil(word.length / 3),
      preprocessWord: word => word.replace('y', 'i'),
    });
    const unigramCount = UnigramCount({ ngrams: ngramsDb });
    const emissionProbs = EmissionProbs({ unigramCount });
    const bigramCount = BigramCount({ ngrams: ngramsDb });
    const allPaths = AllPaths({ bigramCount });
    const maximumPathToEachPossibleTranslation =
      MaximumPathToEachPossibleTranslation({ allPaths, maxPath: maximumPath });
    const translateWord = TranslateWord({
      possibleTranslations,
      emissionProbs,
      maximumPathToEachPossibleTranslation,
    });
    const translateSentence = TranslateSentence({ translateWord });
    // needs unigram count to calculate transitionProb from start of sentence to fist word
    const startOfSentenceMarker = await emissionProbs(Immutable.List([
      Immutable.Map({
        word: '<S>',
        translation: '<S>',
        levenshteinDistance: 0,
        cumulativeProb: 1,
        sentence: Immutable.List(),
      }),
    ]));
    const translateText = TranslateText({ translateSentence, startOfSentenceMarker });
    const textCollector = [];

    process.stdout.write(`${new Date().toISOString()}\n`);

    return new Promise((reject, resolve) => {
      textDb.createReadStream({
        gte: 'txt\x00',
        lte: 'txt\x00\xff',
      }).on('data', async ({ key, value: {
        word,
        posTag,
        inVocab,
      } }) => {
        const [, paragraphNum, sentenceNum, wordNum] = key.split('\x00');
        const paragraphNumber = parseInt(paragraphNum, 10);
        const sentenceNumber = parseInt(sentenceNum, 10);
        const wordNumber = parseInt(wordNum, 10);
        if (textCollector[sentenceNumber] === undefined) {
          textCollector[sentenceNumber] = [];
        }
        textCollector[sentenceNumber][wordNumber] = Immutable.Map({
          word,
          posTag,
          inVocab,
          paragraphNumber,
          sentenceNumber,
          wordNumber,
        });
      })
      .on('close', async () => {
        let translation;
        const text = Immutable.fromJS(textCollector);
        try {
          translation = await translateText(text, Immutable.List());
        } catch (e) {
          throwError(e, 'calling translateText');
        }
        process.stdout.write(`${new Date().toISOString()}\n`);
        resolve(translation);
      }).on('error', (err) => {
        process.stdout.write('text db stream error');
        reject(err);
      });
    });
  }

  return Object.freeze({
    translate,
    TranslateSentence,
    TranslateWord,
    BigramCount,
    UnigramCount,
    PossibleTranslations,
    maximumPath,
    AllPaths,
  });
};

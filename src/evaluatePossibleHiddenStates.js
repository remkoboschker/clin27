/*
  to run the evaluation
    node src/evaluatePossibleHiddenStates -t blankaart -v dict
  -t is the text database
  -v is the vocabulary database
  a database [vocabulary databe]-eval will be created with the result

  to print the scores
    node src/evaluatePossibleHiddenStates -t blankaart -v dict -r count
  to print missing items
    node src/evaluatePossibleHiddenStates -t blankaart -v dict -r missing
  to print the content of the eval db
    node src/evaluatePossibleHiddenStates -t blankaart -v dict -r [any other non empty string]
*/

const level = require('level');
const argv = require('minimist')(process.argv.slice(2));
const _ = require('highland');
const { hiddenStates } = require('./hidden-states');

const deleteEntries = argv.d;
const report = argv.r;
const textName = argv.t;
const vocabName = argv.v

const eval = level(`./db/${vocabName}-eval`, {
  valueEncoding: 'json',
});
/*no-eslint*/
const put = _.wrapCallback(eval.put.bind(eval));
const get = _.wrapCallback(eval.get.bind(eval));
const del = _.wrapCallback(eval.del.bind(eval));

if (deleteEntries) {
  _(eval.createKeyStream({
    gte: `${textName}\x00`,
    lte: `${textName}\x00\xff`,
  }))
  .flatMap(key => del(key))
  .done(() => process.stdout.write(`finished deleting ${textName} ${vocabName}\n`));
} else if (report) {
  const data =  _(eval.createReadStream({
    gte: `${textName}\x00`,
    lte: `${textName}\x00\xff`,
  }))
  .map(({ key, value }) => {
    const [textName, word, translation] = key.split('\x00');
    return {
      textName,
      word,
      translation,
      size: value.size,
      index: value.index,
      count: value.count,
    }
  });
  const print = ({ textName, word, translation, size, index, count, }) =>
    process.stdout.write(`${textName} ${word} ${translation} ${size} ${index} ${count}\n`);
  const done = () => process.stdout.write('finished\n');
  if (report === 'missing') {
    data
    .filter(({ index }) => index === -1)
    .tap(print)
    .done(done);
  } else if (report === 'count') {
    data
    .reduce(({
      totalPossibleStates,
      totalPositions,
      totalWords,
      numberOnTopPosition,
      numberNotFound,
      numberFound,
      maxCount,
      minCount,
      maxCountHit,
      minCountHit,
      maxPosition,
      minPosition,
      totalCount,
      maxSetSize,
      minSetSize,
    }, {
      size,
      index,
      count }) => ({
      totalPossibleStates: totalPossibleStates + size,
      totalPositions: totalPositions + (index > 0 ? index : 0),
      totalWords: totalWords + 1,
      totalCount: totalCount + count,
      numberOnTopPosition: numberOnTopPosition + (index === 0 ? 1 : 0),
      numberNotFound: numberNotFound + (index === -1 ? 1 : 0),
      numberFound: numberFound + (index !== -1 ? 1 : 0),
      averagePosition: totalPositions / totalWords,
      averageSetSize: totalPossibleStates / totalWords,
      averageCount: totalCount / totalWords,
      maxCountHit: index >= 0 && maxCountHit < count ? count : maxCountHit,
      minCountHit: index >= 0 && minCountHit > count ? count : minCountHit,
      maxCount: maxCount < count ? count : maxCountHit,
      minCount: count > 0 && minCount > count ? count : minCountHit,
      maxPosition: maxPosition < index ? index : maxPosition,
      minPosition: minPosition > index ? index : minPosition,
      maxSetSize: maxSetSize < size ? size : maxSetSize,
      minSetSize: minSetSize > size ? size : minSetSize,
    }), {
      totalPossibleStates: 0,
      totalPositions: 0,
      totalWords: 0,
      numberOnTopPosition: 0,
      numberNotFound: 0,
      numberFound: 0,
      maxCountHit: 0,
      minCountHit: 0,
      maxCount: 0,
      minCount: 0,
      maxPosition: 0,
      minPosition: 0,
      totalCount: 0,
      maxSetSize: 0,
      minSetSize: 0,
    })
    .tap(({
      totalPossibleStates,
      totalPositions,
      totalWords,
      totalCount,
      numberOnTopPosition,
      numberNotFound,
      numberFound,
      maxCount,
      minCount,
      maxCountHit,
      minCountHit,
      averageSetSize,
      averagePosition,
      averageCount,
      maxPosition,
      minPosition,
      maxSetSize,
      minSetSize,
    }) => process.stdout.write(`
      totalPossibleStates: ${totalPossibleStates}
      totalPositions: ${totalPositions}
      totalWords: ${totalWords}
      totalCount: ${totalCount}
      numberOnTopPosition: ${numberOnTopPosition}
      percentageOnTopPosition: ${numberOnTopPosition / totalWords}
      numberNotFound: ${numberNotFound}
      percentageNotFound: ${numberNotFound / totalWords}
      numberFound: ${numberFound}
      percentageFound: ${numberFound / totalWords}
      maxCount: ${maxCount}
      minCount: ${minCount}
      maxCountHit: ${maxCountHit}
      minCountHit: ${minCountHit}
      averageSetSize: ${averageSetSize}
      averagePosition: ${averagePosition}
      averageCount: ${averageCount}
      maxPosition: ${maxPosition},
      minPosition: ${minPosition},
      maxSetSize: ${maxSetSize},
      minSetSize: ${minSetSize},
    `))
    .done(done);
  } else {
    data
    .tap(print)
    .done(done);
  }
} else {
  const vocab = level(`./db/${vocabName}`);
  const text = level(`./db/${textName}`);
  const hidden = hiddenStates({ vocab });
  const standard = _(text.createValueStream({
    gte: 'std\x00',
    lte: 'txt\x00\xff',
  }))
  // deal with split words
  .consume((err, x, push, next) => {
    if(err) {
      push(err);
      next()
    } else if (x === _.nil) {
      push(null, x)
      // if the translation contains a word containing a plus
      // this means that two words of the soure text were joined
      // so you need to emit it twice
    } else if (/\+/.test(x)) {
      push(null, x);
      push(null, x);
      next();
    } else {
      push(null, x);
      next();
    }
  })

  _(text.createValueStream({
    gte: 'txt\x00',
    lte: 'txt\x00\xff',
  }))
  .zip(standard)
  .flatMap(([word, translation]) =>
    get(`${textName}\x00${word}\x00${translation}`)
    .consume((err, x, push, next) => {
      if (err) {
        if (err.notFound) {
          hidden(word)
          .collect()
          .map((array) => {
            const checkLabel = a => a === translation;
            //const sortByCount = (a, b) => b.unigramCount - a.unigramCount;
            let index, count;
            // if no counts in vocab
            // if (array && array[0] && array[0].unigramCount === 0 || array[0].unigramCount === undefined) {
            //   index = array.findIndex(checkLabel) === -1 ? -1 : -2;
            // } else {
            // //  index = array.sort(sortByCount).findIndex(checkLabel);
            // }
            // count = index === -1 || index === -2 ? 0 : array[index].unigramCount
            return { index: array.findIndex(a => a === translation), size: array.length, count: 0};
          })
          .tap(stat =>
            process.stdout.write(`${textName} ${vocabName} ${word} ${translation} ${stat.size} ${stat.index} ${stat.count}\n`))
          .flatMap(stat =>
            put(`${textName}\x00${word}\x00${translation}`, stat))
          .done(() => next())
        } else {
          push(err);
        }
      } else if (x === _.nil) {
        push(null, x);
      } else {
        next();
      }
    })
  )
  .done(() => process.stdout.write('finished\n'));
}

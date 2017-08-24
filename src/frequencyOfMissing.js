const level = require('level');
const argv = require('minimist')(process.argv.slice(2));
const _ = require('highland');

const counts = new Map();
const textDb = level('./db/blankaart');

function textStream() {
  const standard = _(textDb.createValueStream({
    gte: 'std\x00',
    lte: 'txt\x00\xff',
  }))
  // deal with split words
  .consume((err, x, push, next) => {
    if (err) {
      push(err);
      next();
    } else if (x === _.nil) {
      push(null, x);
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
  });
  return _(textDb.createValueStream({
    gte: 'txt\x00',
    lte: 'txt\x00\xff',
  }))
  .zip(standard);
}


function countMissing(vocab, text) {
  const vocabDb = level(`./db/${vocab}-eval`, { valueEncoding: 'json' });
  return textStream()
  .flatMap(([word, translation]) =>
    _.wrapCallback(vocabDb.get.bind(vocabDb))(`${text}\x00${word}\x00${translation}`)
    .filter(({ index }) => index === -1)
    .tap(() => {
      if (counts.has(`${word}$${translation}`)) {
        const c = counts.get(`${word}$${translation}`);
        const cv = c[vocab];
        c[vocab] = cv + 1;
        counts.set(`${word}$${translation}`, c);
      } else {
        counts.set(`${word}$${translation}`, {
          'rob-ngram': vocab === 'rob-ngram' ? 1 : 0,
          dict: vocab === 'dict' ? 1 : 0,
          'google-ngram': vocab === 'google-ngram' ? 1 : 0,
        });
      }
    })
  );
}

_([
  countMissing('rob-ngram', 'blankaart0'),
  countMissing('dict', 'blankaart1'),
  countMissing('google-ngram', 'blankaart'),
])
.sequence()
.done(() => counts.forEach((value, key) => {
  const [word, translation] = key.split('$');
  const freq = value.dict === 0 ? (value['rob-ngram'] === 0 ? value['google-ngram'] : value['rob-ngram']) : value.dict
  process.stdout.write(`| ${word} | ${translation} | ${freq} | ${value.dict === 0 ? 'x' : ''} | ${value['rob-ngram'] === 0 ? 'x' : ''} | ${value['google-ngram'] === 0 ? 'x' : ''} |\n`);
}));

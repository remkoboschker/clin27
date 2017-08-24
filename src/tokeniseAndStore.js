// for easy evaluation both source and standard text are tokenized and loaded in
// a leveldb database sorted by key.
// [db name, prefix, paragraphNumber, sentenceNumber, wordNumber] should id the same word
// for source (txt prefix) and standard (std prefix)

const fs = require('fs');
const _ = require('highland');

function pad(num) {
  return `000${num}`.slice(-4);
}

function tokenise(filestream) {
  let paragraphNumber = 0;
  let sentenceNumber = 0;
  let wordNumber = 0;
  return filestream
  // paragraphs
  .splitBy('\n\n')
  .filter(paragraph => paragraph !== ' ' && paragraph !== '')
  .flatMap((paragraph) => {
    paragraphNumber += 1;
    sentenceNumber = 0;
    // sentences
    return _(paragraph.match(/(.+?\s[.?!]\s)(?=[A-Z])|.+/g)) // |(.+?\s[;]\s)
    .flatMap((sentence) => {
      sentenceNumber += 1;
      wordNumber = 0;
      // words
      return _(sentence.match(/[^\s]+/g))
      .map((word) => {
        wordNumber += 1;
        return { paragraphNumber, sentenceNumber, wordNumber, word };
      });
    });
  });
}

function store({ keyPrefix, db }) {
  const put = _.wrapCallback(db.put.bind(db));
  return function ({ paragraphNumber, sentenceNumber, wordNumber, word }) {
    return put(`${keyPrefix}\x00${pad(paragraphNumber)}\x00${pad(sentenceNumber)}\x00${pad(wordNumber)}`, word);
  };
}

function tokeniseAndStore({ filename, keyPrefix, db }) {
  const storage = store({ keyPrefix, db })
  return _(fs.createReadStream(filename, { encoding: 'utf-8' }))
  .through(tokenise)
  .flatMap(storage);
}

module.exports = {
  tokeniseAndStore,
  tokenise,
};

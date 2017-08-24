const _ = require('highland');
const levenshtein = require('automata').lev();

function preprocessWord(word) {
  return word.replace('y', 'i');
}

function scaleDistance(word) {
  return Math.ceil(word.length / 3);
}

function matchFirstCase(original, follower) {
  if (/^[A-Z].*/.test(original)) {
    return follower.slice(0, 1).toUpperCase() + follower.slice(1);
  }
  return follower.slice(0, 1).toLowerCase() + follower.slice(1);
}

function hiddenStates({ vocab }) {
  return function (word) {
    // punctuation will not be altered by translation
    if (!/[a-z]+/.test(word)) {
      return _([word]);
    }

    // syn -> zijn
    if (word === 'syn') {
      return _(['zijn']);
    }
    // 't -> 't
    if (word === '\'t') {
      return _(['\'t']);
    }
    // enz -> enz
    if (word === 'enz') {
      return _(['enz']);
    }
    // der -> van_de
    if (word === 'der') {
      return _(['van_de']);
    }
    // gelijk -> zoals
    if (word === 'gelijk') {
      return _(['zoals']);
    }
    // soo -> dus
    if (word === 'soo') {
      return _(['dus']);
    }
    // hare -> hun
    if (word === 'hare') {
      return _(['hun']);
    }
    // welke -> die
    if (word === 'welke') {
      return _(['die']);
    }

    return _(vocab.createKeyStream({
      gte: 'uni\x00',
      lte: 'uni\x00\xff',
    }))
    .map(key => key.split('\x00')[1])
    .filter(candidate => levenshtein.test({
      max: scaleDistance(word),
      strToMatch: preprocessWord(word),
      str: candidate,
      caseSensitive: false,
    }))
    // add both cases to candidate list
    .flatMap(label => _([
      label.slice(0, 1).toUpperCase() + label.slice(1),
      label.slice(0, 1).toLowerCase() + label.slice(1),
    ]))
    // if there is no entry in the vocabulary, then return the word;
    .otherwise([word]);
  };
}

module.exports = {
  hiddenStates,
  scaleDistance,
  matchFirstCase,
  preprocessWord,
};

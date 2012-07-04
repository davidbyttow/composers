// Copyright 2012 The Obvious Corporation.

/**
 * @fileoverview Unit tests for composers lib. Run with `nodeunit tests/composers_test.js`
 */


var composers = require('../lib/composers')
  , Node = composers.Node
  , nodeunit = require('nodeunit')
  , Q = require('q')
  , Registry = composers.Registry
  , Scope = composers.Scope
  , testCase = nodeunit.testCase


var registry
var scope

function node() {
  return registry.defineNode()
}

function compose(key) {
  return scope.createGraph(key).start()
}

function composeMany(keys) {
  var promises = []
  for (var i in keys) {
    promises.push(compose(keys[i]))
  }
  return promises
}

function delayed(millis, fn) {
  var d = Q.defer()
  setTimeout(function () {
    d.resolve(fn())
  }, millis)
  return d
}

module.exports = testCase({

  setUp: function (done) {
    registry = new Registry()
    scope = new Scope(registry)
    scope.enter()
    done()
  }, 

  tearDown: function (done) {
    scope.exit()
    done()
  },

  testDependencies: function (test) {
    node().outputs('A').with(function () {
      return 'A'
    }).build()

    node().outputs('B').with(function () {
      return Q.resolve('B')
    }).build()

    node().given('A', 'B').outputs('A+B').with(function (a, b) {
      return a.get() + b.get()
    }).build()

    node().outputs('C').with(function () {
      return 'C'
    }).notCacheable().build()

    node().given('A+B', 'C').outputs('A+B+C').with(function (ab, c) {
      return ab.get() + c.get()
    }).build()

    Q.all(composeMany(['A', 'B', 'C', 'A+B'])).spread(function (a, b, c, ab) {
      test.equal(a, 'A')
      test.equal(b, 'B')
      test.equal(c, 'C')
      test.equal(ab, 'AB')
      test.done()
    })
  },

  testExplicits: function (test) {
    node().outputs('A').with(function () {
      return 'A'
    }).build()

    node().given('A', 'B').outputs('A+B').with(function (a, b) {
      return a.get() + b.get()
    }).build()

    var promise = scope.createGraph('A+B')
        .give('B', 'FOO')
        .start()

    promise.then(function (ab) {
      test.equal(ab, 'AFOO')
      test.done()
    })
  },

  testScopeContext: function (test) {
    var childScope = new Scope(registry, scope)
    var context = {
      value: 42
    }

    registry.defineNode().outputs('value').with(function () {
      return this.value
    }).build()

    childScope.enter(context)
    childScope.createGraph('value').start().then(function (value) {
      childScope.exit()
      test.equal(value, 42)
      test.done()
    })
  },

  testCaching: function (test) {
    node().outputs('random').with(function () {
      return Math.random()
    }).build()

    Q.all(composeMany(['random', 'random'])).spread(function (r1, r2) {
      test.equal(r1, r2)
      test.done()
    })
  },

  testNotCacheable: function (test) {
    node().outputs('random').with(function () {
      return Math.random()
    }).notCacheable().build()

    Q.all(composeMany(['random', 'random'])).spread(function (r1, r2) {
      test.notEqual(r1, r2)
      test.done()
    })
  },

  testError: function (test) {
    node().outputs('error').with(function () {
      throw new Error('oops')
    }).build()

    node().given('error').outputs('errorhandler').with(function (e) {
      e.get()  // throws error
    }).build()

    compose('errorhandler').then(undefined, function (err) {
      test.equals(err.message, 'oops')
      test.done()
    })
  },

  testChaining: function (test) {
    node().outputs('delayed').with(function () {
      return delayed(200, function () {
        return 'foo'
      })
    }).build()

    node().given('foo').outputs('foobar').with(function (foo) {
      return foo.get() + 'bar'
    }).build()

    // Bind foobar to the future value of the delayed graph.
    scope.createGraph('foobar').give('foo', scope.createGraph('delayed').start()).start()
        .then(function (foobar) {
          test.equals(foobar, 'foobar')
          test.done()
        })
  },

  testSeeding: function (test) {
    node().given('name').outputs('upper-name').with(function (foo) {
      return foo.get().toUpperCase()
    }).build()

    var childScope = new Scope(registry, scope)
    childScope.seed('name', 'David')
    childScope.enter()
    childScope.createGraph('upper-name').start().then(function (name) {
      childScope.exit()
      test.equal(name, 'DAVID')
      test.done()
    })
  },

  testUnknownNodeError: function (test) {
    node().given('unknown').outputs('nothing').with(function () {})
    try {
      compose('unknown')
      test.ok(false, 'expected assert')
    } catch (expected) {
      test.done()
    }
  },

  testError: function (test) {
    node().outputs('error').with(function () {
      throw new Error('wtf man')
    }).build()

    compose('error').then(undefined, function (err) {
      test.equal(err.message, 'wtf man')
      test.done()
    })
  },

  testSimulation: function (test) {
    node().outputs('first-name').with(function () {
      return delayed(20, function () {
        return 'David'
      })
    }).build()

    node().outputs('last-name').with(function () {
      return delayed(200, function () {
        return 'Byttow'
      })
    }).build()

    node().given('first-name', 'last-name').outputs('full-name')
        .with(function (firstName, lastName) {
          return firstName.get() + ' ' + lastName.get()
        }).build()

    node().given('full-name').outputs('lowercased').with(function (fullName) {
      return fullName.get().toLowerCase()
    }).build()

    node().given('lowercased').outputs('underscored').with(function (name) {
      return delayed(100, function () {
        return name.get().replace(' ', '_')
      })
    }).build()

    compose('underscored').then(function (name) {
      test.equals(name, 'david_byttow')
      test.done()
    })
  }
})

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
  , trace = require('../lib/trace')

var OUTPUT_GRAPHS = false

var registry
var scope

function node() {
  return registry.defineNode()
}

function compose(key) {
  var graph = scope.createGraph(key)
  return graph.start(OUTPUT_GRAPHS).then(function (value) {
    vizualize(graph)
    return value
  }, function (err) {
    vizualize(graph)
    throw err
  })
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

function vizualize(graph) {
  var g = trace.vizualize(graph.getTraceId())
  if (!g) {
    return
  }
  g.setGraphVizPath('./')
  g.output('png', 'graph-' + graph.getOutputKey() + '.png')
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

  /**
   * Tests that graph dependencies work properly.
   */
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

    var graph = scope.createGraph('A+B+C')
    graph.start().then(function () {
      vizualize(graph)
      Q.all(composeMany(['A', 'B', 'C', 'A+B', 'A+B+C'])).spread(function (a, b, c, ab, abc) {
        test.equal(a, 'A')
        test.equal(b, 'B')
        test.equal(c, 'C')
        test.equal(ab, 'AB')
        test.equal(abc, 'ABC')
        test.done()
      })
    }).fail(function (err) {
      console.log(err)
    })
  },

  /**
   * Tests that explicit input binding works.
   */
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

  /**
   * Tests child scopes and that nodes are run with the given context.
   */
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

  /**
   * Tests that nodes are cached by default.
   */
  testCaching: function (test) {
    node().outputs('random').with(function () {
      return Math.random()
    }).build()

    Q.all(composeMany(['random', 'random'])).spread(function (r1, r2) {
      test.equal(r1, r2)
      test.done()
    })
  },

  /**
   * Tests that nodes caching can be disabled.
   */
  testNotCacheable: function (test) {
    node().outputs('random').with(function () {
      return Math.random()
    }).notCacheable().build()

    Q.all(composeMany(['random', 'random'])).spread(function (r1, r2) {
      test.notEqual(r1, r2)
      test.done()
    })
  },

  /**
   * Tests that explicit input bindings can be promises.
   */
  testPromiseBindings: function (test) {
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

  /**
   * Tests that scope seeding works.
   */
  testSeeding: function (test) {
    // This also tests that we support arrays in given.
    node().given(['name', 'number']).outputs('upper-name').with(function (name, number) {
      return name.get().toUpperCase() + number.get()
    }).build()

    var number = 42
    var childScope = new Scope(registry, scope)
    childScope.seed('name', 'David')
    childScope.seed('number', function () { return number; })
    childScope.enter()
    childScope.createGraph('upper-name').start().then(function (name) {
      childScope.exit()
      test.equal(name, 'DAVID42')
      test.done()
    }).end()
  },

  /**
   * Tests that graph callbacks work.
   */
  testGraphCallback: function (test) {
    node().outputs('ok').with(function () {
      return delayed(200, function () {
        return 'ok'
      })
    }).build()

    node().outputs('not-ok').with(function () {
      throw new Error('not-ok')
    }).build()

    scope.createGraph('ok').callback(function (err, ok) {
      test.ok(!err)
      test.equal(ok, 'ok')

      scope.createGraph('not-ok').callback(function (err) {
        test.equal('not-ok', err.message)
        test.done()
      })
    })
  },

  /**
   * Tests that subsequent calls to Input.get() are cached.
   */
  testInputCaching: function (test) {
    node().outputs('value').given('counter').with(function (counter) {
      return counter.get() + '' + counter.get() + '' + counter.get()
    }).build()

    var counter = 0;
    var childScope = new Scope(registry, scope)
    childScope.seed('counter', function () { return ++counter; })
    childScope.enter()
    childScope.createGraph('value').start().then(function (value) {
      childScope.exit()
      test.equal(value, '111')
      test.done()
    }).end()
  },

  /**
   * Tests that attempting to bind to an unknown node fails.
   */
  testUnknownNodeError: function (test) {
    node().given('unknown').outputs('nothing').with(function () {})
    try {
      compose('unknown')
      test.ok(false, 'expected assert')
    } catch (expected) {
      test.done()
    }
  },

  /**
   * Tests that errors propagate appropriately.
   */
  testError: function (test) {
    node().outputs('ok').with(function () {
      return 'ok'
    }).build()

    node().given('ok').outputs('not-ok').with(function () {
      throw new Error('wtf man')
    }).build()

    node().given('not-ok').outputs('error').with(function () {
      throw new Error('wtf man')
    }).build()

    compose('error').then(undefined, function (err) {
      test.equal(err.message, 'wtf man')
      test.done()
    })
  },

  /**
   * Tests that errors can be ignored.
   */
  testErrorIgnored: function (test) {
    node().outputs('ok').with(function () {
      return 'ok'
    }).build()

    node().given('ok').outputs('not-ok').with(function () {
      throw new Error('wtf man')
    }).build()

    node().given('ok', 'not-ok').outputs('ignored').with(function (ok, notOk) {
      // Do nothing with notOk.
      return ok
    }).build()

    compose('ignored').then(function (value) {
      test.ok(value)
      test.done()
    })
  },

  /**
   * Tests various delays and dependencies.
   */
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
    }).notCacheable().build()

    node().given('lowercased').outputs('uppercased').with(function (name) {
      return delayed(200, function () {
        return name.get().toUpperCase()
      })
    }).notCacheable().build()

    node().given('lowercased', 'uppercased', 'underscored').outputs('names').with(
        function (lowercased, uppercased, underscored) {
          return {
              lowercased: lowercased.get()
            , uppercased: uppercased.get()
            , underscored: underscored.get()
          }
        }).build()

    compose('names').then(function (names) {
      test.equals(names.lowercased, 'david byttow')
      test.equals(names.uppercased, 'DAVID BYTTOW')
      test.equals(names.underscored, 'david_byttow')
      test.done()
    })
  }
})

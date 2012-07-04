# Composers: An asynchronous programming framework _(BETA)_

## Overview

A common pattern for implementing asynchronous code flow is by the use of callbacks or futures (aka, promises, deferreds). Historically, this code can be either brittle or simply can be difficult to follow. In the node.js world of “no exceptions should go unhandled” is further complicated by handling and threading errors through callbacks.

Composers abstract the complexities of asynchronous programming.

Some benefits of this model are:
* Discards the need for managing futures, promises or callbacks in business logic code
* Error handling is easier to manage
* Blurs the line between same-process calls and remote service calls
* Provides timing, tracing and visual graph rendering for free (coming soon)

Some cons are:
* Namespaces for output keys are self-managed
* “Thinking in composers” has a bit of a learning curve from traditional callback patterns
* More verbose in some cases

Let's take a contrived, simple example of a dependency graph. Here, we are interested in the value of key A+B+C, which has multiple dependencies, some of which may be latent, remote calls.

```
A     B
 \   /
  A+B   C
    \  /
    A+B+C
```


A simple, callback based example may look something like this (with function names gratuitously named for clarity):

```js
function getA() { return 'A' }

function getFutureB(next) {
  setTimeout(function () {
    next(null, 'B')
  }, 1000)
}

function getC() { return 'C' }

function getFutureAB(next) {
  var a = getA()
  getFutureB(function (err, b) {
    if (err) return next(err)
    next(null, a + b)
  })
}

function getFutureABC(next) {
  var c = getC()
  getFutureAB(function (err, ab) {
    if (err) return next(err)
    next(null, ab + c)
  })
}

getFutureABC(function (err, abc) {
  if (err) throw err
  console.log('A+B+C+:', abc)
})
```


The code above is clear to those familiar with Node's paradigms. However, it is prone-to-error, difficult to maintain and provides little information out-of-the-box during the course of its execution.

With composers, the same can be written as:

```js
registry.defineNode().outputs('A').with(function () {
  return 'A'
}).build()

registry.defineNode().outputs('B').with(function () {
  var d = Q.defer()
  setTimeout(function () {
    d.resolve('B')
  }, 1000)
  return d
}).build()

registry.defineNode().given('A', 'B').outputs('A+B').with(function (a, b) {
  return a.get() + b.get()
}).build()

registry.defineNode().outputs('C').with(function () {
  return 'C'
})

registry.defineNode().given('A+B', 'C').outputs('A+B+C').with(function (ab, c) {
  return ab.get() + c.get()
})

scope.createGraph('A+B+C').start().then(function (abc) {
  console.log('A+B+C+:', abc)
}, function (err) {
  console.log('Error: ', err)
})
```

Few things to note from the comparison example above:
* Handlers can return values or promises
* Callbacks are non-existent
* Values are evaluated from the leaves up, that is, the call path cannot be followed sequentially like the callback method.

_Oh but why so verbose??_ you ask...
Well... you can always wrap and simplify it to your liking. :-)

# Concepts

The basic concepts in composers are:
* Nodes: Logically produce a single output value, given some set of inputs.
* Graphs: Compute a single output value by dynamically constructing a dependency graph of nodes.
* Scopes: Execution contexts for graphs, scopes cache graph node outputs.

All inputs and outputs are defined by a unique key. A node can require any number of inputs, and it is guaranteed that all inputs will be available by the time the node function is executed. A node function can return a value or a promise for a value.

It's very important to note that developer code will not asynchronously execute OR block in the world of composers. All values are readily available when the composer executes. This greatly simplifies coding.

## Thinking in composers

It can be difficult to think in terms of composers, due to their indirect nature. Notably, all nodes run from the "leaves on up," which can confuse some developers. This is outweighed by the benefits that the model provides.


# Using Composers

## Building and Installing

```shell
npm install composers
```

Or grab the source and

```shell
npm install
```

## Testing

```shell
npm install nodeunit -g
nodeunit tests/composers_test.js
```

## Dependencies

Composers requires the [Q Framework](https://github.com/kriskowal/q/) for promises.


## Detailed Design

Composers work by dynamically constructing and evaluating a dependency tree from a global registry of nodes. Each node defines a one single output key and an optional list of input keys. From this simple definition, we can build a dependency sub-tree from any given node by key.

Each node is invoked when all inputs are ready, therefore input values never block and are always present. This greatly simplifies handler method implementations.

Node handler methods must do one of three things:
* Return a value
* Return a future value (using the promises in Q library)
* Throw an error

Returning a value is straightforward and will be cached in the given scope, unless otherwise specified. This is common for values that are readability available, such as query parameters for the current request.

Returning a future value will be taken care of by the composer framework and only resolve the input once the future has been delivered. This is the most common result type for RPC-based handlers, that are waiting on a remote output. See more in the Futures section of this document.

Throwing an error will be caught by the framework and sent down as an input, only to be thrown and handled when it requested. More on that in the Error Handling section below.

### Implicit vs. Explicit Inputs

When a graph is requested and invoked, a dependency tree of inputs is built. Nodes that are predefined and declare an output are also considered implicit inputs for any given graph. However, it is common that some subgraphs will require an explicit input. For example, the id of the current user, which is known when the request is dispatched.

Whether implicit or explicit, for a graph to be valid, all inputs in the transitive closure must be available. Explicit inputs are defined via `give` on the Graph object. For example:

```js
reg.defineNode().outputs('A').with(function () {
  return 'A'
}).build()

reg.defineNode().given('A', 'B').outputs('A+B').with(function (a, b) {
  return a.get() + b.get()
}).build()

var promise = scope.createGraph('A+B')
   .give('B', 'FOO')
   .start()

promise.then(function (ab) {
  console.log(ab.get())  // outputs 'AFOO'
})
```

If B was never bound, then a `Key B not bound` error would be thrown immediately.

### Scopes

Scopes are essentially the execution context of any graph evaluation. The most common scope is the request scope, where for any new request, all nodes are re-computed and cached whenever possible for the lifetime of that request.

Scopes provide the API for creating graphs, and thus, evaluating future values.

### Graphs

Values are retrieved from a graphs. That is, one single value per graph instance. And graphs can only be executed once per instance.

Graphs, when started, will return a future for the output result. Unlike composer methods, graph future callbacks use the standard Node mechanism of returning an (error, value) signature.

Graphs always evaluate from the leaf nodes (dependencies) on up.

### Promises

Promises are objects that will eventually contain a value in the future. The most common operation performed on a future is to attach a callback that is later executed when the value is ready.

Futures are nice, but can become clumsy or prone-to-error when the client must transform future values, handle future result errors, or chain/join multiple futures together to produce a single value. Composers mask all of this by managing futures for the developer.

Typically, services will return a future result as the request is asynchronous, so returning the future to the composer framework is extremely useful. Word of warning: Although it's perfectly reasonable to transform a future and return the future in a single node, you lose the extra benefits to breaking it up into multiple nodes.

For example:

```js
reg.defineNode().outputs('file').with(function () {
  var promise = fileService.getFiles()
  return promise.then(function (files) {
    return transformFiles(files)
  })
}).build()
```

That works, but the inner transformation is completely hidden from the composer system, which means it's never logged or measured in any meaningful way. The way to do this with composers is:

```js
reg.defineNode().outputs('raw-files').with(function () {
  return fileService.getFiles()
}).build()

reg.defineNode().given('raw-files').outputs('files').with(function (files) {
  return transformFiles(files.get())
}).build()
```

Now, clients can request either raw-files or files, the code is simpler and everything is measured, logged and graphed.

### Exception Handling

Composers make exception handling easy by abstracting the need to handle exceptions except at the point the data is requested. That is why each input value is wrapped and accessed with a “get” method. Here is a simple example:

```js
reg.defineNode().outputs('A').with(function () {
  throw new Error('oops!')
}).build()

reg.defineNode().given('A').outputs('B').with(function (a) {
  return a.get() + 1 // throws Error('oops!')
})

...

scope.createGraph('B').start().then(function (b) {
  // never called
}, function(err) {
  // err is equal to Error('oops!')
})
```

It's important to note that when an exception is thrown, it will be logged immediately after the node is evaluated, but the error will not propagate unless its value is used, for example:

```js
scope.createGraph('B').start().then(function (b) {
  // never called, exception suppressed
})
```

### Caching

Caching occurs at the scope level for any given node, unless otherwise specified. For example:

```js
reg.defineNode().outputs('cached').with(function () {
  return Math.random()
}).build()

reg.defineNode().outputs('not-cached').with(function (a) {
  return Math.random()
}).notCacheable().build()

reg.defineNode().given('cached').outputs('A').with(function (cached) {
  return cached.get()  // always returns the same result, A is also cached
}).build()

reg.defineNode().given('not-cached').outputs('B').with(function (notCached) {
  return notCached.get()  // returns unique values, B is also NOT cached
}).build()
```

This makes for good performance by default when requesting nodes multiple times that may result in latent calls.

### Node Timing and Rendering

The evaluation of all nodes is timed and logged accordingly. This gives us the granular flexibility of alerting and introspecting hotspots in our request flow at as granular a level as we'd like.

Additionally, any given request can output a visual graph of all nodes evaluated for the graph along with all timing values and hotspots using gnuplot (or something else).

### Endpoint Agnostic

Another great aspect of this abstraction pattern is callers are agnostic to how the output is derived. Notably, there becomes little need for explicit “services” and theoretically subgraphs can be broken off into separate servers. This gives us a great amount of flexibility when scaling our services.

# Class Overview

Below is a list of the "exposed" interfaces.

## NodeBuilder

Defines composer nodes to be used in the graph. Each node has the following properties:
* A single output key
* Zero or more input keys
* A handler function
* Options (cacheable, etc)

NodeBuilders can be created in one of two ways:
```js
var builder = registry.defineNode()
```
Or
```js
var builder = new NodeBuilder(registry)
```

It exposes the following API, which is chainable:

### NodeBuilder.given(...) => NodeBuilder
Declares a set of input keys as dependencies for this node. (Optional)

### NodeBuilder.outputs({String} outputKey) => NodeBuilder
Sets the unique key that this node outputs. (Required)

### NodeBuilder.with({Function} fn) => NodeBuilder
Sets the handler that will be invoked when the node's inputs are ready and output should be produced. (Required)

### NodeBuilder.notCacheable() => NodeBuilder
Declares this node as NOT cacheable. (Optional)

### NodeBuilder.build()
Finalizes and adds the node into the scope's registry. (Required)

## Registry

The registry is the container that keys all nodes by their output value. Generally, there is a single global registry that all nodes are registered into.

Registry's are meant to be constructed once, used to define nodes and passed into scopes.

```js
var registry = new Registry()
```

### Registry.defineNode() => NodeBuilder
Used to define a node, see the Node DSL above.

## Scope

A scope is the realm in which graphs are evaluated and node output values are cached. Scopes must be `enter`ed before nodes can be evaluated.

To create a scope, you must supply the registry that it will register nodes in and an optional parent scope.

```js
var scope = new Scope(registry)
```

### Scope.createGraph({String} outputKey) => Graph
Creates a new graph for evaluation for a single output key. The scope must be entered when calling this. Any evaluated outputs (either explicit or implicit) will be cached in this scope while it is open.

### Scope.enter({Object=} opt_scopeContext)
Enters the current scope with an empty cache for output keys. An optional context may be passed to the scope, which is the context that all nodes will be evaluated in within this scope.

### Scope.exit()
Exits the current scope and clears the cache of evaluated nodes.

### Scope.seed({String} key, {*} value})
Seeds the given value for the specified key in this scope. This is useful for inputs that are not bound to specific nodes and are scope-specific. For example, a request-based scope (a new scope for every inbound request) might seed the request and response objects to 'req' and 'resp' keys for nodes to input.

## Graph

A graph represents the dependency tree in the global set of nodes used to obtain a single output value. To construct a graph, you must use an (active) scope.

```js
// Create a graph for the output key named 'foobar'
var graph = scope.createGraph('foobar')
```

Once a graph is created, you may bind specific input keys required for the graph to evaluate with `give`. For example, evaluating 'search-results' will probably require an input key named something like 'search-query', which is specific to that individual request. To do this, you must use `give`.

### Graph.start() => {Q.promise}
Starts the graph for evaluation, can only be started once. Returns a promised result.

### Graph.give({String} key, {*} value) => Graph
Adds a particular node into the graph for evaluation. Typically this is used when a given output key relies on an input that is not implicitly provided by another node. For example:

```js
scope.newGraph('search-results').give('search-query', query).start()
    .then(function (results) {
      // Do something with the results.
    })
```

Alternatively, sometimes it's useful to give the graph a future result. To do this, you can bind a future input with a promise, or the output of another graph (for chaining).

```js
// Note, this is a contrived example. Typically user-data would simply depend on the user key.
var futureUser = scope.newGraph('user').give('user-id', userId).start()
scope.newGraph('user-data').give('user', futureUser).start().then(function (data) {
  // Do something with user data.	
})
```

## Input
As alluded to above, actual values are not passed into node handlers. Instead, a special `Input` class with a single `.get()` method is. This method, when called, will either return the value or throw an exception that the originating node had raised.

### Input.get() => {*}


# Appendix

## BETA
Note, this is only in beta stages and is expected to be developed significantly over a relatively short period of time. It's quite close to the metal right now in terms of API and we will learn about how best to take advantage of composers over time. 

More importantly though, note that the core API may change, which is the most important reason why this is still a _beta release_.

In the mean time, please keep the feedback coming!

## TODO

* Add per-node tracing and error reporting hooks
* Add graph output mode


## Contributing

Questions, comments, bug reports, and pull requests are all welcome.
Submit them at [the project on GitHub](https://github.com/Obvious/composers/).

Bug reports that include steps-to-reproduce (including code) are the
best. Even better, make them in the form of pull requests that update
the test suite. Thanks!


## Author

[David Byttow](https://github.com/guitardave24)
supported by [The Obvious Corporation](http://obvious.com/).


## License

Copyright 2012 [The Obvious Corporation](http://obvious.com/).

Licensed under the Apache License, Version 2.0.
See the top-level file `LICENSE.txt` and
(http://www.apache.org/licenses/LICENSE-2.0).

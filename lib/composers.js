// Copyright 2012 The Obvious Corporation.

/**
 * @fileoverview Provides the interfaces for the composer API. See the README for more info.
 */

var Q = require('q')
  , microtime = require('microtime')
  , trace = require('./trace')
  , util = require('util')
  , Trace = trace.Trace

// See JS doc below for more information about the exported classes.
module.exports = {
  vizualize: trace.vizualize
  , Graph: Graph
  , Node: Node
  , Registry: Registry
  , Scope: Scope
}

/**
 * Returns true if the given object appears to be a promise.
 * @param {Object} obj
 * @return {boolean}
 */
function isPromise(obj) {
  return Q.isPromise(obj)
}


/**
 * Returns true if the given object appears to be a deferred.
 * @param {Object} obj
 @ return {boolean}
 */
function isDeferred(obj) {
  return obj && obj.promise && isPromise(obj.promise)
}


/**
 * Creates a promise for a value that is already available.
 * @param {*} value
 * @return {!Promise}
 */
function immediatePromise(value) {
  return Q.resolve(value)
}


/**
 * Creates an error throwing promise.
 * @param {!Error} err
 * @return {!Promise}
 */
function immediateFailedPromise(err) {
  return Q.reject(err)
}


/**
 * Simple cache. Undefined values become null.
 * @constructor
 */
function Cache() {
  /**
   * @type {!Object}
   * @private
   */
  this._cache = {}
}

/**
 * Puts a single value into the cache. Undefined will be cached as a null value.
 * @param {string} key
 * @param {*} value
 */
Cache.prototype.put = function (key, value) {
  value = (value !== undefined) ? value : null
  this._cache[key] = value
}

/**
 * Puts the given key and value into the cache only if it doesn't exist. Returns
 * true if it succeeded.
 * @param {string} key
 * @param {*} value
 * @return {boolean}
 */
Cache.prototype.putIfAbsent = function (key, value) {
  if (this.has(key)) {
    return false
  }
  this.put(key, value)
  return true
}

/**
 * Returns the cached value or undefined if it doesn't exist.
 * @param {string} key
 * @return {*}
 */
Cache.prototype.get = function (key) {
  return this._cache[key]
}

/**
 * Returns true if the given key is present in the cache.
 * @param {string} key
 * @return {boolean}
 */
Cache.prototype.has = function (key) {
  return key in this._cache
}

/**
 * Clears this cache.
 */
Cache.prototype.clear = function () {
  this._cache = {}
}


/**
 * Wraps a promise as an input with a single getter that may throw.
 * @param {Promise} promise
 * @constructor
 */
function Input(promise) {
  this._promise = promise
}

/**
 * Returns the input value or throws the original error thrown by the source.
 * @return {*}
 * @throws {Error} if the source through an error.
 */ 
Input.prototype.get = function () {
  if (this._promise.isRejected()) {
    throw this._promise.valueOf().exception
  }
  return this._promise.valueOf()
}


/**
 * Contains immutable properties for a node.
 */
function NodeProperties() {
  /**
   * List of input key dependencies.
   * @type {!Array.<string>}
   */
  this.inputKeys = []
  
  /**
   * Output key for this node.
   * @type {string}
   */
  this.outputKey

  /**
   * Function handler to evaluate the node.
   * @type {Function}
   */
  this.fn

  /**
   * Whether or not this node is cacheable.
   * @type {boolean}
   */
  this.noCache = false

  /**
   * Whether or not this is an explicit node.
   * @type {boolean}
   */
  this.explicit = false
}


/**
 * Constructs a node that must satisfy the minimum number of fields.
 * @param {!Registry} registry
 * @constructor
 */
function NodeBuilder(registry) {
  /**
   * @type {!Registry}
   * @private
   */
  this._registry = registry

  /**
   * @type {!NodeProperties}
   * @private
   */
  this._props = new NodeProperties()
}

/**
 * Declares a set of input keys for this node.
 * @param {...}
 * @return {!NodeBuilder} this instance
 */
NodeBuilder.prototype.given = function () {
  this._props.inputKeys = []
  for (var i = 0; i < arguments.length; ++i) {
    this._props.inputKeys.push(arguments[i])
  }
  return this
}

/**
 * Declares the key that this node outputs.
 * @param {string} outputKey
 * @return {!NodeBuilder} this instance
 */
NodeBuilder.prototype.outputs = function (outputKey) {
  this._props.outputKey = outputKey
  return this
}

/**
 * Declares handler that the node uses to construct an output.
 * @param {Function} fn
 * @return {!NodeBuilder} this instance
 */
NodeBuilder.prototype.with = function (fn) {
  this._props.fn = fn
  return this
}

/**
 * Declares this node to not be cacheable.
 * @return {!NodeBuilder} this instance
 */
NodeBuilder.prototype.notCacheable = function () {
  this._props.noCache = true
  return this
}


/**
 * Builds a new, immutable node.
 */
NodeBuilder.prototype.build = function () {
  this._registry.add(new Node(this._props))
}


/**
 * Defines a node that contains inputs, an output, a handler method and additional options.
 * @param {!NodeProperties} properties
 * @constructor
 */
function Node(properties) {
  this._props = properties
}

/**
 * Returns the node's properties.
 * @return {!NodeProperties}
 */
Node.prototype.getProperties = function () {
  return this._props
}

/**
 * Returns the output key for this node.
 * @return {string}
 */
Node.prototype.getOutputKey = function () {
  return this._props.outputKey
}

/**
 * Returns the list of input keys that this node depends on.
 * @return {!Array.<string>}
 */
Node.prototype.getDependencies = function () {
  return this._props.inputKeys
}

/**
 * Returns the handler function for this node.
 * @return {Function}
 */
Node.prototype.getFunction = function () {
  return this._props.fn
}

/**
 * Returns true if this node is cacheable.
 * @return {boolean}
 */
Node.prototype.isCacheable = function () {
  return !this._props.noCache
}

/**
 * Returns a node that has no dependencies and returns the given value.
 * @param {string} outputKey
 * @param {string} value
 * @return {!Node}
 */
Node.explicit = function (outputKey, value) {
  var props = new NodeProperties()
  props.outputKey = outputKey
  props.explicit = true
  props.fn = function () { return value }
  return new Node(props)
}


/**
 * Graph class that manages building a dependency tree for any given output key and evaluating it.
 * @param {string} outputKey
 * @param {!Scope} scope the scope that this graph executes in
 * constructor
 */
function Graph(outputKey, scope) {
  /**
   * Output key for this graph.
   * @type {string}
   */
  this._outputKey = outputKey

  /**
   * Scope that this graph executes in.
   * @type {!Scope}
   * @private
   */
  this._scope = scope
  
  /**
   * Explicit input bindings for this graph evaluation.
   * @type {!Cache.<Promise>}
   * @private
   */
  this._explicitInputs = new Cache()

  /**
   * Whether or not this graph has executed.
   * @type {boolean}
   * @private
   */
  this._started = false

  /**
   * Tracer.
   * @type {Trace}
   * @private
   */
  this._trace = null
}

/**
 * Returns the graph's output key.
 * @return {string}
 */
Graph.prototype.getOutputKey = function () {
  return this._outputKey
}

/**
 * Binds the input key to the explicit value or a promised value.
 * @param {string} inputKey
 * @param {*|Promise} value binds the given value or a promise for the value.
 * @return {!Graph} this instance
 */
Graph.prototype.give = function (key, value) {
  if (this._started) {
    throw new Error('Graph already started')
  }
  this._explicitInputs.put(key, immediatePromise(value))
  return this
}

/**
 * Starts execution of this graph.
 * @param {boolean} opt_enableTracing if true, this graph will be traced.
 * @return {!Promise} promised result
 */
Graph.prototype.start = function (opt_enableTracing) {
  if (this._started) {
    throw new Error('Graph already started')
  }

  if (opt_enableTracing) {
    this._trace = new Trace()
  }

  var node = this._getNode(this._outputKey)
  return this._endTrace(this._resolveGraph(node))
}

/**
 * Gets the trace id for this graph if it was traced.
 * @return {string|undefined}
 */
Graph.prototype.getTraceId = function() {
  return this._trace ? this._trace.getId() : null
}

/**
 * Returns the node for the given key, either implicit or explicit. Looks up explicit nodes first.
 * @param {string} key
 * @return {!Node}
 * @throws {Error} if the node was never bound.
 */
Graph.prototype._getNode = function (key) {
  if (this._explicitInputs.has(key)) {
    return Node.explicit(key, this._explicitInputs.get(key))
  }

  // TODO(david): Error out if overriding an already implicit node?
  var node = this._scope.getNode(key)
  if (!node) {
    throw new Error('Key not bound: ' + key)
  }
  return node
}

/**
 * Resolves the dependency tree for the given subgraph and evaluates it.
 * @param {!Node} node root of the subgraph to evaluate.
 * @return {!Promise} promised result of the graph
 */
Graph.prototype._resolveGraph = function (node) {
  var dependencies = node.getDependencies()
  if (!dependencies.length) {
    return this._resolveNode(node, [], true)
  }

  var cacheableInputs = true
  var promises = []
  for (var i = 0; i < dependencies.length; ++i) {
    var dep = this._getNode(dependencies[i])
    cacheableInputs &= dep.isCacheable()
    promises.push(this._resolveGraph(dep))
  }

  var self = this
  return Q.allResolved(promises).then(function (promises) {
    return self._resolveNode(node, promises, cacheableInputs)
  })
}


/**
 * Resolves the given node with a set of input values and caches the output if possible.
 * @param {!Node} node
 * @param {!Array.<Promises>} promises list of dependencies as promises for this node
 * @param {boolean} cacheableDependencies whether or not the dependencies are cacheable.
 * @return {!Promise}
 */
Graph.prototype._resolveNode = function (node, promises, cacheableDependencies) {
  var key = node.getOutputKey()
  var startNanos = microtime.now()

  var p = this._getPromisedNodeResult(key)
  if (!p) {
    p = this._invokeNode(node, promises)
    if (cacheableDependencies && node.isCacheable()) {
      // Cache the future promise.
      this._scope.cache(key, p)
    }
  }

  return this._traceResult(node, p, startNanos)
}

/**
 * Times the duration of the node execution and adds it to the trace.
 * @param {!Node} node
 * @param {!Promise} promise
 * @param {number} startNanos
 * @param {!Promise}
 */
Graph.prototype._traceResult = function (node, promise, startNanos) {
  if (!this._trace) {
    return promise
  }

  var trace = this._trace
  return promise.then(function (value) {
    trace.add(node, microtime.now() - startNanos)
    return value
  }, function (err) {
    trace.add(node, microtime.now() - startNanos, err)
    throw err
  })
}

/**
 * Finalizes the trace.
 * @param {!Promise} promise
 * @return {!Promise}
 */
Graph.prototype._endTrace = function(promise) {
  if (!this._trace) {
    return promise
  }

  var trace = this._trace
  return promise.then(function (value) {
    trace.end()
    return value
  }, function (err) {
    trace.end()
    throw err
  })
}

/**
 * Returns the already promised node result if it exists, or null.
 * @param {string} key
 * @return {Promise}
 */
Graph.prototype._getPromisedNodeResult = function (key) {
  return this._scope.getValue(key) || null
}

/**
 * Invokes the given node with the set of input values.
 * @param {Node} node
 * @param {!Array.<Promise>} promises resolved or rejected promises.
 * @return {!Promise}
 */
Graph.prototype._invokeNode = function (node, promises) {
  var inputs = []
  for (var i in promises) {
    inputs.push(new Input(promises[i]))
  }

  var res
  var err
  try {
    res = node.getFunction().apply(this._scope.getContext(), inputs)
  } catch (e) {
    err = e
  }

  // We support passing back promises, deferreds or values.
  if (isPromise(res)) {
    return res
  }

  if (isDeferred(res)) {
    return res.promise
  }

  return err ? immediateFailedPromise(err) : immediatePromise(res)
}


/**
 * Defines a scope for evaluating graphs and caching all output values. Scopes must be entered
 * before they can evaluate a graph.
 * @param {!Registry} registry node registry
 * @param {Scope=} opt_parent parent scope.
 * @constructor
 */
function Scope(registry, opt_parent) {
  /**
   * Registry for this scope.
   * @type {!Registry}
   */
  this._registry = registry

  /**
   * Parent scope.
   * @param {Scope}
   * @private
   */
  this._parent = opt_parent || null

  /**
   * Cache of seeded values.
   * @type {!Cache}
   */
  this._seedCache = new Cache()

  /**
   * Cache of computed values.
   * @type {!Cache}
   */
  this._valueCache = new Cache()

  /**
   * Whether or not we're in scope.
   * @type {boolean}
   */
  this._inScope = false

  /**
   * The context that node handlers will be run with.
   * @type {Object}
   * @private
   */
  this._context = null
}

/**
 * Instantiates a new graph for evaluation.
 * @param {string} key output key to create a graph for.
 * @return {!Graph}
 */
Scope.prototype.createGraph = function (key) {
  if (!this._inScope) {
    throw new Error('Scope never entered')
  }
  return new Graph(key, this)
}

/**
 * Returns the given node in this scope or null if it doesn't exist.
 * @param {string} outputKey
 * @return {Node}
 */
Scope.prototype.getNode = function (outputKey) {
  if (this._seedCache.has(outputKey)) {
    return Node.explicit(outputKey, this._seedCache.get(outputKey))
  }

  var node = this._registry.getNode(outputKey)
  if (node || !this._parent) {
    return node
  }
  return this._parent.getNode(outputKey)
}

/**
 * Enters this scope, which is required for creating graphs. Scope must be
 * exited when finished.
 * @param {Object=} opt_scopeContext optional context for all node handler functions.
 */
 // TODO(david): Use an executor pattern instead of enter/exit?
Scope.prototype.enter = function (opt_scopeContext) {
  if (this._inScope) {
    throw new Error('Scope already entered')
  }
  this._context = opt_scopeContext || null
  this._inScope = true
}

/**
 * Exits this scope, which abandons all computed values.
 */
Scope.prototype.exit = function () {
  if (!this._inScope) {
    throw new Error('Scope never entered or already exited')
  }
  this._inScope = false
  this._seedCache.clear()
  this._valueCache.clear()
  this._context = null
}

/**
 * Seeds the given key and value into this scope.
 * @param {string} key
 * @param {*} value
 */
Scope.prototype.seed = function (key, value) {
  if (this._inScope) {
    throw new Error('Cannot seed values while in scope')
  }
  if (!this._seedCache.putIfAbsent(key, value)) {
    throw new Error('Value for', key, 'was already supplied in this scope. Prev: ',
        this._seedCache.get(key), 'New:', value)
  }
}

/**
 * Caches the given output key value into this scope.
 * @param {string} key
 * @param {*} value
 */
Scope.prototype.cache = function (key, value) {
  if (!this._inScope) {
    throw new Error('Cannot cache value when not in scope')
  }
  if (!this._valueCache.putIfAbsent(key, immediatePromise(value))) {
    throw new Error('Value for', key, 'was already supplied in this scope. Prev: ',
        this._valueCache.get(key), 'New:', value)
  }
}

/**
 * Returns the context for this scope.
 * @return {Object}
 * @private
 */
Scope.prototype.getContext = function () {
  return this._context
}

/**
 * Returns the computed value for a given key, or undefined if it doesn't exist.
 * @param {string} key
 * @return {*}
 */
Scope.prototype.getValue = function (key) {
  if (this._valueCache.has(key)) {
    return this._valueCache.get(key) || undefined
  }
  return this._parent ? this._parent.getValue(key) : undefined
}


/**
 * Registry class that contains all available nodes by key.
 * @constructor
 */
function Registry() {
  /**
   * Mapping of output keys to nodes.
   * @type {!Object.<Node>}
   */
  this._nodeMap = {}
}

/**
 * Creates NodeBuilder instance for this registry.
 * @return {!NodeBuilder}
 */
Registry.prototype.defineNode = function () {
  return new NodeBuilder(this)
}

/**
 * Adds a node to the registry.
 * @param {!Node} node
 * @throws {Error} if the node was not fully specified or the output key is already registry.
 */
Registry.prototype.add = function (node) {
  var outputKey = node.getOutputKey()
  if (!outputKey) {
    throw new Error('Output key never declared')
  }

  if (!node.getFunction()) {
    throw new Error('Node does not have handler: ' + outputKey)
  }

  if (outputKey in this._nodeMap) {
    throw new Error('Node', key, 'already registered in this scope.')
  }

  this._nodeMap[outputKey] = node
}


/**
 * Gets the given node or null if it doesn't exist.
 * @param {string} key
 * @return {Node}
 */
Registry.prototype.getNode = function (key) {
  return this._nodeMap[key] || null
}

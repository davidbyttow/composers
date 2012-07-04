// Copyright 2012 The Obvious Corporation.

/**
 * @fileoverview Provides the interfaces for the composer API's tracing capabilities. Requires graphviz.
 */

var graphviz = require('graphviz')
  , uuid = require('node-uuid')

module.exports = {
    vizualize: vizualize
  , Trace: Trace
}


/**
 * 2^53 (also the year 2055 in nanoseconds)
 * @param {number}
 */
var MAX_INT = 9007199254740992


/**
 * Recorded traces.
 * @type {!Object.<Trace>}
 */
// TODO(david): Garbage collect traces.
var traces = {}


/**
 * Given a trace id, render the graph. If the trace is not available, null is returned.
 * @param {string} traceId
 * @return {Object}
 */
function vizualize(traceId) {
  if (!(traceId in traces)) {
    return null
  }
  return traces[traceId].graphViz()
}


/** 
 * Class that represents a single trace event.
 * @constructor
 */
function Trace() {
  /**
   * Unique identifier (uuid) for this trace.
   * @type {string}
   * @private
   */
  this._id = uuid.v4()


  /**
   * Map of event output key names.
   * @type {Object}
   * @private
   */
  this._eventMap = {}
}

/**
 * Returns the trace's unique id.
 * @return {string}
 */
Trace.prototype.getId = function () {
  return this._id
}

/**
 * Adds a trace event and it's duration time.
 * @param {!Node} node the node that was traced.
 * @param {number} durationNanos duration of execution in nanoseconds.
 * @param {Error=} opt_err optional error that was thrown in the node.
 */
Trace.prototype.add = function (node, durationNanos, opt_err) {
  var outputKey = node.getOutputKey()
  var e = this._eventMap[outputKey]
  if (!e) {
    var e = {
        props: node.getProperties()
      , durations: []
    }

    if (opt_err) {
      e.exception = opt_err
    }
    this._eventMap[outputKey] = e
  }
  e.durations.push(durationNanos)
}

/**
 * Returns a label for the node based on a list of durations.
 * Outputs [min],[max],[mean] or simply the exact time the node took to execute.
 * @param {number} durations
 * @param {string}
 */
function getTimingLabel(durations) {
  var min = MAX_INT
    , max = 0
    , sum = 0
  for (var i = 0; i < durations.length; ++i) {
    var v = durations[i]
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  if (min == max) {
    return min + ''
  }
  return min + ',' + max + ',' + sum / durations.length
}

/**
 * Creates a primed graphviz object out of this trace. Only adds nodes
 * and edges.
 * @return {Object}
 */
Trace.prototype.graphViz = function () {
  var g = graphviz.digraph('G')

  // First build the list of nodes.
  var nodes = {}
  for (var k in this._eventMap) {
    var e = this._eventMap[k]
    if (!(k in nodes)) {
      var color = e.exception ? '#FF2200' : '#66DD00'
      var timing = getTimingLabel(e.durations)
      var label = k + '\\n' + timing + ' (µ)'
      nodes[k] = g.addNode(k, {'fillcolor': color, 'style': 'filled', 'label': label})
    }
  }

  // Then create the edges.
  for (var k in this._eventMap) {
    var e = this._eventMap[k]
    var inputs = e.props.inputKeys
    for (var i = 0; i < inputs.length; ++i) {
      var to = this._eventMap[inputs[i]]
      var props = {}
      props['label'] = to.durations.length
      g.addEdge(nodes[inputs[i]], nodes[k], props)
    }
  }

  return g
}

/**
 * Finalizes the trace, which registers it in the list of recorded traces.
 */
Trace.prototype.end = function () {
  traces[this._id] = this
}

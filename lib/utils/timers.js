const EE = require('events')
const { resolve } = require('path')
const fs = require('@npmcli/fs')
const log = require('./log-shim')

const _timeListener = Symbol('timeListener')
const _timeEndListener = Symbol('timeEndListener')
const _init = Symbol('init')

// This is an event emiiter but on/off
// only listen on a single internal event that gets
// emitted whenever a timer ends
class Timers extends EE {
  static filename = '_timing.json'

  #unfinished = new Map()
  #finished = {}
  #onTimeEnd = Symbol('onTimeEnd')
  #dir = null
  #initialListener = null
  #initialTimer = null

  constructor ({ listener = null, start = 'npm' } = {}) {
    super()
    this.#initialListener = listener
    this.#initialTimer = start
    this[_init]()
  }

  get unfinished () {
    return this.#unfinished
  }

  get finished () {
    return this.#finished
  }

  [_init] () {
    this.on()
    if (this.#initialListener) {
      this.on(this.#initialListener)
    }
    process.emit('time', this.#initialTimer)
    this.started = this.#unfinished.get(this.#initialTimer)
  }

  on (listener) {
    if (listener) {
      super.on(this.#onTimeEnd, listener)
    } else {
      process.on('time', this[_timeListener])
      process.on('timeEnd', this[_timeEndListener])
    }
  }

  off (listener) {
    if (listener) {
      super.off(this.#onTimeEnd, listener)
    } else {
      this.removeAllListeners(this.#onTimeEnd)
      process.off('time', this[_timeListener])
      process.off('timeEnd', this[_timeEndListener])
    }
  }

  time (name, fn) {
    process.emit('time', name)
    const end = () => process.emit('timeEnd', name)
    if (typeof fn === 'function') {
      const res = fn()
      return res && res.finally ? res.finally(end) : (end(), res)
    }
    return end
  }

  load ({ dir }) {
    this.#dir = dir
  }

  writeFile (fileData) {
    try {
      const globalStart = this.started
      const globalEnd = this.#finished.npm || Date.now()
      const content = {
        ...fileData,
        ...this.#finished,
        // add any unfinished timers with their relative start/end
        unfinished: [...this.#unfinished.entries()].reduce((acc, [name, start]) => {
          acc[name] = [start - globalStart, globalEnd - globalStart]
          return acc
        }, {}),
      }
      const f = resolve(this.#dir, this.constructor.filename)
      // we append line delimited json to this file...forever
      // XXX: should we also write a process specific timing file?
      // with similar rules to the debug log (max files, etc)
      fs.withOwnerSync(
        f,
        () => fs.appendFileSync(f, JSON.stringify(content) + '\n'),
        { owner: 'inherit' }
      )
    } catch (e) {
      log.warn('timing', 'could not write timing file', e)
    }
  }

  [_timeListener] = (name) => {
    this.#unfinished.set(name, Date.now())
  }

  [_timeEndListener] = (name) => {
    if (this.#unfinished.has(name)) {
      const ms = Date.now() - this.#unfinished.get(name)
      this.#finished[name] = ms
      this.#unfinished.delete(name)
      this.emit(this.#onTimeEnd, name, ms)
    } else {
      log.silly('timing', "Tried to end timer that doesn't exist:", name)
    }
  }
}

module.exports = Timers

// Copyright (c) Microsoft Open Technologies, Inc. All rights reserved. See License.txt in the project root for license information.

;(function (factory) {
  var objectTypes = {
    'function': true,
    'object': true
  };

  var
    freeExports = objectTypes[typeof exports] && exports && !exports.nodeType && exports,
    freeSelf = objectTypes[typeof self] && self.Object && self,
    freeWindow = objectTypes[typeof window] && window && window.Object && window,
    freeModule = objectTypes[typeof module] && module && !module.nodeType && module,
    moduleExports = freeModule && freeModule.exports === freeExports && freeExports,
    freeGlobal = freeExports && freeModule && typeof global == 'object' && global && global.Object && global;

  var root = root = freeGlobal || ((freeWindow !== (this && this.window)) && freeWindow) || freeSelf || this;

  // Because of build optimizers
  if (typeof define === 'function' && define.amd) {
    define(['./rx'], function (Rx, exports) {
      return factory(root, exports, Rx);
    });
  } else if (typeof module === 'object' && module && module.exports === freeExports) {
    module.exports = factory(root, module.exports, require('./rx'));
  } else {
    root.Rx = factory(root, {}, root.Rx);
  }
}.call(this, function (root, exp, Rx, undefined) {

  // Refernces
  var inherits = Rx.internals.inherits,
    AbstractObserver = Rx.internals.AbstractObserver,
    Observable = Rx.Observable,
    observableProto = Observable.prototype,
    AnonymousObservable = Rx.AnonymousObservable,
    ObservableBase = Rx.ObservableBase,
    observableDefer = Observable.defer,
    observableEmpty = Observable.empty,
    observableNever = Observable.never,
    observableThrow = Observable['throw'],
    observableFromArray = Observable.fromArray,
    defaultScheduler = Rx.Scheduler['default'],
    SingleAssignmentDisposable = Rx.SingleAssignmentDisposable,
    SerialDisposable = Rx.SerialDisposable,
    CompositeDisposable = Rx.CompositeDisposable,
    BinaryDisposable = Rx.BinaryDisposable,
    RefCountDisposable = Rx.RefCountDisposable,
    Subject = Rx.Subject,
    addRef = Rx.internals.addRef,
    normalizeTime = Rx.Scheduler.normalize,
    helpers = Rx.helpers,
    isPromise = helpers.isPromise,
    isFunction = helpers.isFunction,
    isScheduler = Rx.Scheduler.isScheduler,
    observableFromPromise = Observable.fromPromise;

  var errorObj = {e: {}};
  
  function tryCatcherGen(tryCatchTarget) {
    return function tryCatcher() {
      try {
        return tryCatchTarget.apply(this, arguments);
      } catch (e) {
        errorObj.e = e;
        return errorObj;
      }
    };
  }

  var tryCatch = Rx.internals.tryCatch = function tryCatch(fn) {
    if (!isFunction(fn)) { throw new TypeError('fn must be a function'); }
    return tryCatcherGen(fn);
  };

  function thrower(e) {
    throw e;
  }

  var TimerObservable = (function(__super__) {
    inherits(TimerObservable, __super__);
    function TimerObservable(dt, s) {
      this._dt = dt;
      this._s = s;
      __super__.call(this);
    }

    TimerObservable.prototype.subscribeCore = function (o) {
      return this._s.scheduleFuture(o, this._dt, scheduleMethod);
    };

    function scheduleMethod(s, o) {
      o.onNext(0);
      o.onCompleted();
    }

    return TimerObservable;
  }(ObservableBase));

  function _observableTimer(dueTime, scheduler) {
    return new TimerObservable(dueTime, scheduler);
  }

  function observableTimerDateAndPeriod(dueTime, period, scheduler) {
    return new AnonymousObservable(function (observer) {
      var d = dueTime, p = normalizeTime(period);
      return scheduler.scheduleRecursiveFuture(0, d, function (count, self) {
        if (p > 0) {
          var now = scheduler.now();
          d = d + p;
          d <= now && (d = now + p);
        }
        observer.onNext(count);
        self(count + 1, new Date(d));
      });
    });
  }

  function observableTimerTimeSpanAndPeriod(dueTime, period, scheduler) {
    return dueTime === period ?
      new AnonymousObservable(function (observer) {
        return scheduler.schedulePeriodic(0, period, function (count) {
          observer.onNext(count);
          return count + 1;
        });
      }) :
      observableDefer(function () {
        return observableTimerDateAndPeriod(new Date(scheduler.now() + dueTime), period, scheduler);
      });
  }

  /**
   *  Returns an observable sequence that produces a value after each period.
   *
   * @example
   *  1 - res = Rx.Observable.interval(1000);
   *  2 - res = Rx.Observable.interval(1000, Rx.Scheduler.timeout);
   *
   * @param {Number} period Period for producing the values in the resulting sequence (specified as an integer denoting milliseconds).
   * @param {Scheduler} [scheduler] Scheduler to run the timer on. If not specified, Rx.Scheduler.timeout is used.
   * @returns {Observable} An observable sequence that produces a value after each period.
   */
  var observableinterval = Observable.interval = function (period, scheduler) {
    return observableTimerTimeSpanAndPeriod(period, period, isScheduler(scheduler) ? scheduler : defaultScheduler);
  };

  /**
   *  Returns an observable sequence that produces a value after dueTime has elapsed and then after each period.
   * @param {Number} dueTime Absolute (specified as a Date object) or relative time (specified as an integer denoting milliseconds) at which to produce the first value.
   * @param {Mixed} [periodOrScheduler]  Period to produce subsequent values (specified as an integer denoting milliseconds), or the scheduler to run the timer on. If not specified, the resulting timer is not recurring.
   * @param {Scheduler} [scheduler]  Scheduler to run the timer on. If not specified, the timeout scheduler is used.
   * @returns {Observable} An observable sequence that produces a value after due time has elapsed and then each period.
   */
  var observableTimer = Observable.timer = function (dueTime, periodOrScheduler, scheduler) {
    var period;
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    if (periodOrScheduler != null && typeof periodOrScheduler === 'number') {
      period = periodOrScheduler;
    } else if (isScheduler(periodOrScheduler)) {
      scheduler = periodOrScheduler;
    }
    if ((dueTime instanceof Date || typeof dueTime === 'number') && period === undefined) {
      return _observableTimer(dueTime, scheduler);
    }
    if (dueTime instanceof Date && period !== undefined) {
      return observableTimerDateAndPeriod(dueTime.getTime(), periodOrScheduler, scheduler);
    }
    return observableTimerTimeSpanAndPeriod(dueTime, period, scheduler);
  };

  function observableDelayRelative(source, dueTime, scheduler) {
    return new AnonymousObservable(function (o) {
      var active = false,
        cancelable = new SerialDisposable(),
        exception = null,
        q = [],
        running = false,
        subscription;
      subscription = source.materialize().timestamp(scheduler).subscribe(function (notification) {
        var d, shouldRun;
        if (notification.value.kind === 'E') {
          q = [];
          q.push(notification);
          exception = notification.value.error;
          shouldRun = !running;
        } else {
          q.push({ value: notification.value, timestamp: notification.timestamp + dueTime });
          shouldRun = !active;
          active = true;
        }
        if (shouldRun) {
          if (exception !== null) {
            o.onError(exception);
          } else {
            d = new SingleAssignmentDisposable();
            cancelable.setDisposable(d);
            d.setDisposable(scheduler.scheduleRecursiveFuture(null, dueTime, function (_, self) {
              var e, recurseDueTime, result, shouldRecurse;
              if (exception !== null) {
                return;
              }
              running = true;
              do {
                result = null;
                if (q.length > 0 && q[0].timestamp - scheduler.now() <= 0) {
                  result = q.shift().value;
                }
                if (result !== null) {
                  result.accept(o);
                }
              } while (result !== null);
              shouldRecurse = false;
              recurseDueTime = 0;
              if (q.length > 0) {
                shouldRecurse = true;
                recurseDueTime = Math.max(0, q[0].timestamp - scheduler.now());
              } else {
                active = false;
              }
              e = exception;
              running = false;
              if (e !== null) {
                o.onError(e);
              } else if (shouldRecurse) {
                self(null, recurseDueTime);
              }
            }));
          }
        }
      });
      return new BinaryDisposable(subscription, cancelable);
    }, source);
  }

  function observableDelayAbsolute(source, dueTime, scheduler) {
    return observableDefer(function () {
      return observableDelayRelative(source, dueTime - scheduler.now(), scheduler);
    });
  }

  function delayWithSelector(source, subscriptionDelay, delayDurationSelector) {
    var subDelay, selector;
    if (isFunction(subscriptionDelay)) {
      selector = subscriptionDelay;
    } else {
      subDelay = subscriptionDelay;
      selector = delayDurationSelector;
    }
    return new AnonymousObservable(function (o) {
      var delays = new CompositeDisposable(), atEnd = false, subscription = new SerialDisposable();

      function start() {
        subscription.setDisposable(source.subscribe(
          function (x) {
            var delay = tryCatch(selector)(x);
            if (delay === errorObj) { return o.onError(delay.e); }
            var d = new SingleAssignmentDisposable();
            delays.add(d);
            d.setDisposable(delay.subscribe(
              function () {
                o.onNext(x);
                delays.remove(d);
                done();
              },
              function (e) { o.onError(e); },
              function () {
                o.onNext(x);
                delays.remove(d);
                done();
              }
            ));
          },
          function (e) { o.onError(e); },
          function () {
            atEnd = true;
            subscription.dispose();
            done();
          }
        ));
      }

      function done () {
        atEnd && delays.length === 0 && o.onCompleted();
      }

      if (!subDelay) {
        start();
      } else {
        subscription.setDisposable(subDelay.subscribe(start, function (e) { o.onError(e); }, start));
      }

      return new BinaryDisposable(subscription, delays);
    }, this);
  }

  /**
   *  Time shifts the observable sequence by dueTime.
   *  The relative time intervals between the values are preserved.
   *
   * @param {Number} dueTime Absolute (specified as a Date object) or relative time (specified as an integer denoting milliseconds) by which to shift the observable sequence.
   * @param {Scheduler} [scheduler] Scheduler to run the delay timers on. If not specified, the timeout scheduler is used.
   * @returns {Observable} Time-shifted sequence.
   */
  observableProto.delay = function () {
    var firstArg = arguments[0];
    if (typeof firstArg === 'number' || firstArg instanceof Date) {
      var dueTime = firstArg, scheduler = arguments[1];
      isScheduler(scheduler) || (scheduler = defaultScheduler);
      return dueTime instanceof Date ?
        observableDelayAbsolute(this, dueTime, scheduler) :
        observableDelayRelative(this, dueTime, scheduler);
    } else if (Observable.isObservable(firstArg) || isFunction(firstArg)) {
      return delayWithSelector(this, firstArg, arguments[1]);
    } else {
      throw new Error('Invalid arguments');
    }
  };

  var DebounceObservable = (function (__super__) {
    inherits(DebounceObservable, __super__);
    function DebounceObservable(source, dt, s) {
      isScheduler(s) || (s = defaultScheduler);
      this.source = source;
      this._dt = dt;
      this._s = s;
      __super__.call(this);
    }

    DebounceObservable.prototype.subscribeCore = function (o) {
      var cancelable = new SerialDisposable();
      return new BinaryDisposable(
        this.source.subscribe(new DebounceObserver(o, this.source, this._dt, this._s, cancelable)),
        cancelable);
    };

    return DebounceObservable;
  }(ObservableBase));

  var DebounceObserver = (function (__super__) {
    inherits(DebounceObserver, __super__);
    function DebounceObserver(observer, source, dueTime, scheduler, cancelable) {
      this._o = observer;
      this._s = source;
      this._d = dueTime;
      this._scheduler = scheduler;
      this._c = cancelable;
      this._v = null;
      this._hv = false;
      this._id = 0;
      __super__.call(this);
    }

    DebounceObserver.prototype.next = function (x) {
      this._hv = true;
      this._v = x;
      var currentId = ++this._id, d = new SingleAssignmentDisposable();
      this._c.setDisposable(d);
      d.setDisposable(this._scheduler.scheduleFuture(this, this._d, function (_, self) {
        self._hv && self._id === currentId && self._o.onNext(x);
        self._hv = false;
      }));
    };

    DebounceObserver.prototype.error = function (e) {
      this._c.dispose();
      this._o.onError(e);
      this._hv = false;
      this._id++;
    };

    DebounceObserver.prototype.completed = function () {
      this._c.dispose();
      this._hv && this._o.onNext(this._v);
      this._o.onCompleted();
      this._hv = false;
      this._id++;
    };

    return DebounceObserver;
  }(AbstractObserver));

  function debounceWithSelector(source, durationSelector) {
    return new AnonymousObservable(function (o) {
      var value, hasValue = false, cancelable = new SerialDisposable(), id = 0;
      var subscription = source.subscribe(
        function (x) {
          var throttle = tryCatch(durationSelector)(x);
          if (throttle === errorObj) { return o.onError(throttle.e); }

          isPromise(throttle) && (throttle = observableFromPromise(throttle));

          hasValue = true;
          value = x;
          id++;
          var currentid = id, d = new SingleAssignmentDisposable();
          cancelable.setDisposable(d);
          d.setDisposable(throttle.subscribe(
            function () {
              hasValue && id === currentid && o.onNext(value);
              hasValue = false;
              d.dispose();
            },
            function (e) { o.onError(e); },
            function () {
              hasValue && id === currentid && o.onNext(value);
              hasValue = false;
              d.dispose();
            }
          ));
        },
        function (e) {
          cancelable.dispose();
          o.onError(e);
          hasValue = false;
          id++;
        },
        function () {
          cancelable.dispose();
          hasValue && o.onNext(value);
          o.onCompleted();
          hasValue = false;
          id++;
        }
      );
      return new BinaryDisposable(subscription, cancelable);
    }, source);
  }

  observableProto.debounce = function () {
    if (isFunction (arguments[0])) {
      return debounceWithSelector(this, arguments[0]);
    } else if (typeof arguments[0] === 'number') {
      return new DebounceObservable(this, arguments[0], arguments[1]);
    } else {
      throw new Error('Invalid arguments');
    }
  };

  /**
   *  Projects each element of an observable sequence into zero or more windows which are produced based on timing information.
   * @param {Number} timeSpan Length of each window (specified as an integer denoting milliseconds).
   * @param {Mixed} [timeShiftOrScheduler]  Interval between creation of consecutive windows (specified as an integer denoting milliseconds), or an optional scheduler parameter. If not specified, the time shift corresponds to the timeSpan parameter, resulting in non-overlapping adjacent windows.
   * @param {Scheduler} [scheduler]  Scheduler to run windowing timers on. If not specified, the timeout scheduler is used.
   * @returns {Observable} An observable sequence of windows.
   */
  observableProto.windowWithTime = function (timeSpan, timeShiftOrScheduler, scheduler) {
    var source = this, timeShift;
    timeShiftOrScheduler == null && (timeShift = timeSpan);
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    if (typeof timeShiftOrScheduler === 'number') {
      timeShift = timeShiftOrScheduler;
    } else if (isScheduler(timeShiftOrScheduler)) {
      timeShift = timeSpan;
      scheduler = timeShiftOrScheduler;
    }
    return new AnonymousObservable(function (observer) {
      var groupDisposable,
        nextShift = timeShift,
        nextSpan = timeSpan,
        q = [],
        refCountDisposable,
        timerD = new SerialDisposable(),
        totalTime = 0;
        groupDisposable = new CompositeDisposable(timerD),
        refCountDisposable = new RefCountDisposable(groupDisposable);

       function createTimer () {
        var m = new SingleAssignmentDisposable(),
          isSpan = false,
          isShift = false;
        timerD.setDisposable(m);
        if (nextSpan === nextShift) {
          isSpan = true;
          isShift = true;
        } else if (nextSpan < nextShift) {
            isSpan = true;
        } else {
          isShift = true;
        }
        var newTotalTime = isSpan ? nextSpan : nextShift,
          ts = newTotalTime - totalTime;
        totalTime = newTotalTime;
        if (isSpan) {
          nextSpan += timeShift;
        }
        if (isShift) {
          nextShift += timeShift;
        }
        m.setDisposable(scheduler.scheduleFuture(null, ts, function () {
          if (isShift) {
            var s = new Subject();
            q.push(s);
            observer.onNext(addRef(s, refCountDisposable));
          }
          isSpan && q.shift().onCompleted();
          createTimer();
        }));
      };
      q.push(new Subject());
      observer.onNext(addRef(q[0], refCountDisposable));
      createTimer();
      groupDisposable.add(source.subscribe(
        function (x) {
          for (var i = 0, len = q.length; i < len; i++) { q[i].onNext(x); }
        },
        function (e) {
          for (var i = 0, len = q.length; i < len; i++) { q[i].onError(e); }
          observer.onError(e);
        },
        function () {
          for (var i = 0, len = q.length; i < len; i++) { q[i].onCompleted(); }
          observer.onCompleted();
        }
      ));
      return refCountDisposable;
    }, source);
  };

  /**
   *  Projects each element of an observable sequence into a window that is completed when either it's full or a given amount of time has elapsed.
   * @param {Number} timeSpan Maximum time length of a window.
   * @param {Number} count Maximum element count of a window.
   * @param {Scheduler} [scheduler]  Scheduler to run windowing timers on. If not specified, the timeout scheduler is used.
   * @returns {Observable} An observable sequence of windows.
   */
  observableProto.windowWithTimeOrCount = function (timeSpan, count, scheduler) {
    var source = this;
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    return new AnonymousObservable(function (observer) {
      var timerD = new SerialDisposable(),
          groupDisposable = new CompositeDisposable(timerD),
          refCountDisposable = new RefCountDisposable(groupDisposable),
          n = 0,
          windowId = 0,
          s = new Subject();

      function createTimer(id) {
        var m = new SingleAssignmentDisposable();
        timerD.setDisposable(m);
        m.setDisposable(scheduler.scheduleFuture(null, timeSpan, function () {
          if (id !== windowId) { return; }
          n = 0;
          var newId = ++windowId;
          s.onCompleted();
          s = new Subject();
          observer.onNext(addRef(s, refCountDisposable));
          createTimer(newId);
        }));
      }

      observer.onNext(addRef(s, refCountDisposable));
      createTimer(0);

      groupDisposable.add(source.subscribe(
        function (x) {
          var newId = 0, newWindow = false;
          s.onNext(x);
          if (++n === count) {
            newWindow = true;
            n = 0;
            newId = ++windowId;
            s.onCompleted();
            s = new Subject();
            observer.onNext(addRef(s, refCountDisposable));
          }
          newWindow && createTimer(newId);
        },
        function (e) {
          s.onError(e);
          observer.onError(e);
        }, function () {
          s.onCompleted();
          observer.onCompleted();
        }
      ));
      return refCountDisposable;
    }, source);
  };

  function toArray(x) { return x.toArray(); }

  /**
   *  Projects each element of an observable sequence into zero or more buffers which are produced based on timing information.
   * @param {Number} timeSpan Length of each buffer (specified as an integer denoting milliseconds).
   * @param {Mixed} [timeShiftOrScheduler]  Interval between creation of consecutive buffers (specified as an integer denoting milliseconds), or an optional scheduler parameter. If not specified, the time shift corresponds to the timeSpan parameter, resulting in non-overlapping adjacent buffers.
   * @param {Scheduler} [scheduler]  Scheduler to run buffer timers on. If not specified, the timeout scheduler is used.
   * @returns {Observable} An observable sequence of buffers.
   */
  observableProto.bufferWithTime = function (timeSpan, timeShiftOrScheduler, scheduler) {
    return this.windowWithTime(timeSpan, timeShiftOrScheduler, scheduler).flatMap(toArray);
  };

  function toArray(x) { return x.toArray(); }

  /**
   *  Projects each element of an observable sequence into a buffer that is completed when either it's full or a given amount of time has elapsed.
   * @param {Number} timeSpan Maximum time length of a buffer.
   * @param {Number} count Maximum element count of a buffer.
   * @param {Scheduler} [scheduler]  Scheduler to run bufferin timers on. If not specified, the timeout scheduler is used.
   * @returns {Observable} An observable sequence of buffers.
   */
  observableProto.bufferWithTimeOrCount = function (timeSpan, count, scheduler) {
    return this.windowWithTimeOrCount(timeSpan, count, scheduler).flatMap(toArray);
  };

  var TimeIntervalObservable = (function (__super__) {
    inherits(TimeIntervalObservable, __super__);
    function TimeIntervalObservable(source, s) {
      this.source = source;
      this._s = s;
      __super__.call(this);
    }

    TimeIntervalObservable.prototype.subscribeCore = function (o) {
      return this.source.subscribe(new TimeIntervalObserver(o, this._s));
    };

    return TimeIntervalObservable;
  }(ObservableBase));

  var TimeIntervalObserver = (function (__super__) {
    inherits(TimeIntervalObserver, __super__);

    function TimeIntervalObserver(o, s) {
      this._o = o;
      this._s = s;
      this._l = s.now();
      __super__.call(this);
    }

    TimeIntervalObserver.prototype.next = function (x) {
      var now = this._s.now(), span = now - this._l;
      this._l = now;
      this._o.onNext({ value: x, interval: span });
    };
    TimeIntervalObserver.prototype.error = function (e) { this._o.onError(e); };
    TimeIntervalObserver.prototype.completed = function () { this._o.onCompleted(); };

    return TimeIntervalObserver;
  }(AbstractObserver));

  /**
   *  Records the time interval between consecutive values in an observable sequence.
   *
   * @example
   *  1 - res = source.timeInterval();
   *  2 - res = source.timeInterval(Rx.Scheduler.timeout);
   *
   * @param [scheduler]  Scheduler used to compute time intervals. If not specified, the timeout scheduler is used.
   * @returns {Observable} An observable sequence with time interval information on values.
   */
  observableProto.timeInterval = function (scheduler) {
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    return new TimeIntervalObservable(this, scheduler);
  };

  var TimestampObservable = (function (__super__) {
    inherits(TimestampObservable, __super__);
    function TimestampObservable(source, s) {
      this.source = source;
      this._s = s;
      __super__.call(this);
    }

    TimestampObservable.prototype.subscribeCore = function (o) {
      return this.source.subscribe(new TimestampObserver(o, this._s));
    };

    return TimestampObservable;
  }(ObservableBase));

  var TimestampObserver = (function (__super__) {
    inherits(TimestampObserver, __super__);
    function TimestampObserver(o, s) {
      this._o = o;
      this._s = s;
      __super__.call(this);
    }

    TimestampObserver.prototype.next = function (x) {
      this._o.onNext({ value: x, timestamp: this._s.now() });
    };

    TimestampObserver.prototype.error = function (e) {
      this._o.onError(e);
    };

    TimestampObserver.prototype.completed = function () {
      this._o.onCompleted();
    };

    return TimestampObserver;
  }(AbstractObserver));

  /**
   *  Records the timestamp for each value in an observable sequence.
   *
   * @example
   *  1 - res = source.timestamp(); // produces { value: x, timestamp: ts }
   *  2 - res = source.timestamp(Rx.Scheduler.default);
   *
   * @param {Scheduler} [scheduler]  Scheduler used to compute timestamps. If not specified, the default scheduler is used.
   * @returns {Observable} An observable sequence with timestamp information on values.
   */
  observableProto.timestamp = function (scheduler) {
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    return new TimestampObservable(this, scheduler);
  };

  function sampleObservable(source, sampler) {
    return new AnonymousObservable(function (o) {
      var atEnd = false, value, hasValue = false;

      function sampleSubscribe() {
        if (hasValue) {
          hasValue = false;
          o.onNext(value);
        }
        atEnd && o.onCompleted();
      }

      var sourceSubscription = new SingleAssignmentDisposable();
      sourceSubscription.setDisposable(source.subscribe(
        function (newValue) {
          hasValue = true;
          value = newValue;
        },
        function (e) { o.onError(e); },
        function () {
          atEnd = true;
          sourceSubscription.dispose();
        }
      ));

      return new BinaryDisposable(
        sourceSubscription,
        sampler.subscribe(sampleSubscribe, function (e) { o.onError(e); }, sampleSubscribe)
      );
    }, source);
  }

  /**
   *  Samples the observable sequence at each interval.
   *
   * @example
   *  1 - res = source.sample(sampleObservable); // Sampler tick sequence
   *  2 - res = source.sample(5000); // 5 seconds
   *  2 - res = source.sample(5000, Rx.Scheduler.timeout); // 5 seconds
   *
   * @param {Mixed} intervalOrSampler Interval at which to sample (specified as an integer denoting milliseconds) or Sampler Observable.
   * @param {Scheduler} [scheduler]  Scheduler to run the sampling timer on. If not specified, the timeout scheduler is used.
   * @returns {Observable} Sampled observable sequence.
   */
  observableProto.sample = observableProto.throttleLatest = function (intervalOrSampler, scheduler) {
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    return typeof intervalOrSampler === 'number' ?
      sampleObservable(this, observableinterval(intervalOrSampler, scheduler)) :
      sampleObservable(this, intervalOrSampler);
  };

  var TimeoutError = Rx.TimeoutError = function(message) {
    this.message = message || 'Timeout has occurred';
    this.name = 'TimeoutError';
    Error.call(this);
  };
  TimeoutError.prototype = Object.create(Error.prototype);

  function timeoutWithSelector(source, firstTimeout, timeoutDurationSelector, other) {
    if (isFunction(firstTimeout)) {
      other = timeoutDurationSelector;
      timeoutDurationSelector = firstTimeout;
      firstTimeout = observableNever();
    }
    other || (other = observableThrow(new TimeoutError()));
    return new AnonymousObservable(function (o) {
      var subscription = new SerialDisposable(), timer = new SerialDisposable(), original = new SingleAssignmentDisposable();

      subscription.setDisposable(original);

      var id = 0, switched = false;

      function setTimer(timeout) {
        var myId = id, d = new SingleAssignmentDisposable();
        timer.setDisposable(d);
        d.setDisposable(timeout.subscribe(function () {
          id === myId && subscription.setDisposable(other.subscribe(o));
          d.dispose();
        }, function (e) {
          id === myId && o.onError(e);
        }, function () {
          id === myId && subscription.setDisposable(other.subscribe(o));
        }));
      };

      setTimer(firstTimeout);

      function oWins() {
        var res = !switched;
        if (res) { id++; }
        return res;
      }

      original.setDisposable(source.subscribe(function (x) {
        if (oWins()) {
          o.onNext(x);
          var timeout = tryCatch(timeoutDurationSelector)(x);
          if (timeout === errorObj) { return o.onError(timeout.e); }
          setTimer(isPromise(timeout) ? observableFromPromise(timeout) : timeout);
        }
      }, function (e) {
        oWins() && o.onError(e);
      }, function () {
        oWins() && o.onCompleted();
      }));
      return new BinaryDisposable(subscription, timer);
    }, source);
  }

  function timeout(source, dueTime, other, scheduler) {
    if (isScheduler(other)) {
      scheduler = other;
      other = observableThrow(new TimeoutError());
    }
    if (other instanceof Error) { other = observableThrow(other); }
    isScheduler(scheduler) || (scheduler = defaultScheduler);

    return new AnonymousObservable(function (o) {
      var id = 0,
        original = new SingleAssignmentDisposable(),
        subscription = new SerialDisposable(),
        switched = false,
        timer = new SerialDisposable();

      subscription.setDisposable(original);

      function createTimer() {
        var myId = id;
        timer.setDisposable(scheduler.scheduleFuture(null, dueTime, function () {
          if (id === myId) {
            isPromise(other) && (other = observableFromPromise(other));
            subscription.setDisposable(other.subscribe(o));
          }
        }));
      }

      createTimer();

      original.setDisposable(source.subscribe(function (x) {
        if (!switched) {
          id++;
          o.onNext(x);
          createTimer();
        }
      }, function (e) {
        if (!switched) {
          id++;
          o.onError(e);
        }
      }, function () {
        if (!switched) {
          id++;
          o.onCompleted();
        }
      }));
      return new BinaryDisposable(subscription, timer);
    }, source);
  }

  observableProto.timeout = function () {
    var firstArg = arguments[0];
    if (firstArg instanceof Date || typeof firstArg === 'number') {
      return timeout(this, firstArg, arguments[1], arguments[2]);
    } else if (Observable.isObservable(firstArg) || isFunction(firstArg)) {
      return timeoutWithSelector(this, firstArg, arguments[1], arguments[2]);
    } else {
      throw new Error('Invalid arguments');
    }
  };

  var GenerateAbsoluteObservable = (function (__super__) {
    inherits(GenerateAbsoluteObservable, __super__);
    function GenerateAbsoluteObservable(state, cndFn, itrFn, resFn, timeFn, s) {
      this._state = state;
      this._cndFn = cndFn;
      this._itrFn = itrFn;
      this._resFn = resFn;
      this._timeFn = timeFn;
      this._s = s;
      this._first = true;
      this._hasResult = false;
      __super__.call(this);
    }

    function scheduleRecursive(self, recurse) {
      self._hasResult && self._o.onNext(self._state);

      if (self._first) {
        self._first = false;
      } else {
        self._state = tryCatch(self._itrFn)(self._state);
        if (self._state === errorObj) { return self._o.onError(self._state.e); }
      }
      self._hasResult = tryCatch(self._cndFn)(self._state);
      if (self._hasResult === errorObj) { return self._o.onError(self._hasResult.e); }
      if (self._hasResult) {
        var result = tryCatch(self._resFn)(self._state);
        if (result === errorObj) { return self._o.onError(result.e); }
        var time = tryCatch(self._timeFn)(self._state);
        if (time === errorObj) { return self._o.onError(time.e); }
        recurse(self, time);
      } else {
        self._o.onCompleted();
      }
    }

    GenerateAbsoluteObservable.prototype.subscribeCore = function (o) {
      this._o = o;
      return this._s.scheduleRecursiveFuture(this, new Date(this._s.now()), scheduleRecursive);
    };

    return GenerateAbsoluteObservable;
  }(ObservableBase));

  /**
   *  GenerateAbsolutes an observable sequence by iterating a state from an initial state until the condition fails.
   *
   * @example
   *  res = source.generateWithAbsoluteTime(0,
   *      function (x) { return return true; },
   *      function (x) { return x + 1; },
   *      function (x) { return x; },
   *      function (x) { return new Date(); }
   *  });
   *
   * @param {Mixed} initialState Initial state.
   * @param {Function} condition Condition to terminate generation (upon returning false).
   * @param {Function} iterate Iteration step function.
   * @param {Function} resultSelector Selector function for results produced in the sequence.
   * @param {Function} timeSelector Time selector function to control the speed of values being produced each iteration, returning Date values.
   * @param {Scheduler} [scheduler]  Scheduler on which to run the generator loop. If not specified, the timeout scheduler is used.
   * @returns {Observable} The generated sequence.
   */
  Observable.generateWithAbsoluteTime = function (initialState, condition, iterate, resultSelector, timeSelector, scheduler) {
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    return new GenerateAbsoluteObservable(initialState, condition, iterate, resultSelector, timeSelector, scheduler);
  };

  var GenerateRelativeObservable = (function (__super__) {
    inherits(GenerateRelativeObservable, __super__);
    function GenerateRelativeObservable(state, cndFn, itrFn, resFn, timeFn, s) {
      this._state = state;
      this._cndFn = cndFn;
      this._itrFn = itrFn;
      this._resFn = resFn;
      this._timeFn = timeFn;
      this._s = s;
      this._first = true;
      this._hasResult = false;
      __super__.call(this);
    }

    function scheduleRecursive(self, recurse) {
      self._hasResult && self._o.onNext(self._state);

      if (self._first) {
        self._first = false;
      } else {
        self._state = tryCatch(self._itrFn)(self._state);
        if (self._state === errorObj) { return self._o.onError(self._state.e); }
      }
      self._hasResult = tryCatch(self._cndFn)(self._state);
      if (self._hasResult === errorObj) { return self._o.onError(self._hasResult.e); }
      if (self._hasResult) {
        var result = tryCatch(self._resFn)(self._state);
        if (result === errorObj) { return self._o.onError(result.e); }
        var time = tryCatch(self._timeFn)(self._state);
        if (time === errorObj) { return self._o.onError(time.e); }
        recurse(self, time);
      } else {
        self._o.onCompleted();
      }
    }

    GenerateRelativeObservable.prototype.subscribeCore = function (o) {
      this._o = o;
      return this._s.scheduleRecursiveFuture(this, 0, scheduleRecursive);
    };

    return GenerateRelativeObservable;
  }(ObservableBase));

  /**
   *  Generates an observable sequence by iterating a state from an initial state until the condition fails.
   *
   * @example
   *  res = source.generateWithRelativeTime(0,
   *      function (x) { return return true; },
   *      function (x) { return x + 1; },
   *      function (x) { return x; },
   *      function (x) { return 500; }
   *  );
   *
   * @param {Mixed} initialState Initial state.
   * @param {Function} condition Condition to terminate generation (upon returning false).
   * @param {Function} iterate Iteration step function.
   * @param {Function} resultSelector Selector function for results produced in the sequence.
   * @param {Function} timeSelector Time selector function to control the speed of values being produced each iteration, returning integer values denoting milliseconds.
   * @param {Scheduler} [scheduler]  Scheduler on which to run the generator loop. If not specified, the timeout scheduler is used.
   * @returns {Observable} The generated sequence.
   */
  Observable.generateWithRelativeTime = function (initialState, condition, iterate, resultSelector, timeSelector, scheduler) {
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    return new GenerateRelativeObservable(initialState, condition, iterate, resultSelector, timeSelector, scheduler);
  };

  var DelaySubscription = (function(__super__) {
    inherits(DelaySubscription, __super__);
    function DelaySubscription(source, dt, s) {
      this.source = source;
      this._dt = dt;
      this._s = s;
      __super__.call(this);
    }

    DelaySubscription.prototype.subscribeCore = function (o) {
      var d = new SerialDisposable();

      d.setDisposable(this._s.scheduleFuture([this.source, o, d], this._dt, scheduleMethod));

      return d;
    };

    function scheduleMethod(s, state) {
      var source = state[0], o = state[1], d = state[2];
      d.setDisposable(source.subscribe(o));
    }

    return DelaySubscription;
  }(ObservableBase));

  /**
   *  Time shifts the observable sequence by delaying the subscription with the specified relative time duration, using the specified scheduler to run timers.
   *
   * @example
   *  1 - res = source.delaySubscription(5000); // 5s
   *  2 - res = source.delaySubscription(5000, Rx.Scheduler.default); // 5 seconds
   *
   * @param {Number} dueTime Relative or absolute time shift of the subscription.
   * @param {Scheduler} [scheduler]  Scheduler to run the subscription delay timer on. If not specified, the timeout scheduler is used.
   * @returns {Observable} Time-shifted sequence.
   */
  observableProto.delaySubscription = function (dueTime, scheduler) {
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    return new DelaySubscription(this, dueTime, scheduler);
  };

  var SkipLastWithTimeObservable = (function (__super__) {
    inherits(SkipLastWithTimeObservable, __super__);
    function SkipLastWithTimeObservable(source, d, s) {
      this.source = source;
      this._d = d;
      this._s = s;
      __super__.call(this);
    }

    SkipLastWithTimeObservable.prototype.subscribeCore = function (o) {
      return this.source.subscribe(new SkipLastWithTimeObserver(o, this));
    };

    return SkipLastWithTimeObservable;
  }(ObservableBase));

  var SkipLastWithTimeObserver = (function (__super__) {
    inherits(SkipLastWithTimeObserver, __super__);

    function SkipLastWithTimeObserver(o, p) {
      this._o = o;
      this._s = p._s;
      this._d = p._d;
      this._q = [];
      __super__.call(this);
    }

    SkipLastWithTimeObserver.prototype.next = function (x) {
      var now = this._s.now();
      this._q.push({ interval: now, value: x });
      while (this._q.length > 0 && now - this._q[0].interval >= this._d) {
        this._o.onNext(this._q.shift().value);
      }
    };
    SkipLastWithTimeObserver.prototype.error = function (e) { this._o.onError(e); };
    SkipLastWithTimeObserver.prototype.completed = function () {
      var now = this._s.now();
      while (this._q.length > 0 && now - this._q[0].interval >= this._d) {
        this._o.onNext(this._q.shift().value);
      }
      this._o.onCompleted();
    };

    return SkipLastWithTimeObserver;
  }(AbstractObserver));

  /**
   *  Skips elements for the specified duration from the end of the observable source sequence, using the specified scheduler to run timers.
   * @description
   *  This operator accumulates a queue with a length enough to store elements received during the initial duration window.
   *  As more elements are received, elements older than the specified duration are taken from the queue and produced on the
   *  result sequence. This causes elements to be delayed with duration.
   * @param {Number} duration Duration for skipping elements from the end of the sequence.
   * @param {Scheduler} [scheduler]  Scheduler to run the timer on. If not specified, defaults to Rx.Scheduler.timeout
   * @returns {Observable} An observable sequence with the elements skipped during the specified duration from the end of the source sequence.
   */
  observableProto.skipLastWithTime = function (duration, scheduler) {
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    return new SkipLastWithTimeObservable(this, duration, scheduler);
  };

  /**
   *  Returns elements within the specified duration from the end of the observable source sequence, using the specified schedulers to run timers and to drain the collected elements.
   * @description
   *  This operator accumulates a queue with a length enough to store elements received during the initial duration window.
   *  As more elements are received, elements older than the specified duration are taken from the queue and produced on the
   *  result sequence. This causes elements to be delayed with duration.
   * @param {Number} duration Duration for taking elements from the end of the sequence.
   * @param {Scheduler} [scheduler]  Scheduler to run the timer on. If not specified, defaults to Rx.Scheduler.timeout.
   * @returns {Observable} An observable sequence with the elements taken during the specified duration from the end of the source sequence.
   */
  observableProto.takeLastWithTime = function (duration, scheduler) {
    var source = this;
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    return new AnonymousObservable(function (o) {
      var q = [];
      return source.subscribe(function (x) {
        var now = scheduler.now();
        q.push({ interval: now, value: x });
        while (q.length > 0 && now - q[0].interval >= duration) {
          q.shift();
        }
      }, function (e) { o.onError(e); }, function () {
        var now = scheduler.now();
        while (q.length > 0) {
          var next = q.shift();
          if (now - next.interval <= duration) { o.onNext(next.value); }
        }
        o.onCompleted();
      });
    }, source);
  };

  /**
   *  Returns an array with the elements within the specified duration from the end of the observable source sequence, using the specified scheduler to run timers.
   * @description
   *  This operator accumulates a queue with a length enough to store elements received during the initial duration window.
   *  As more elements are received, elements older than the specified duration are taken from the queue and produced on the
   *  result sequence. This causes elements to be delayed with duration.
   * @param {Number} duration Duration for taking elements from the end of the sequence.
   * @param {Scheduler} scheduler Scheduler to run the timer on. If not specified, defaults to Rx.Scheduler.timeout.
   * @returns {Observable} An observable sequence containing a single array with the elements taken during the specified duration from the end of the source sequence.
   */
  observableProto.takeLastBufferWithTime = function (duration, scheduler) {
    var source = this;
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    return new AnonymousObservable(function (o) {
      var q = [];
      return source.subscribe(function (x) {
        var now = scheduler.now();
        q.push({ interval: now, value: x });
        while (q.length > 0 && now - q[0].interval >= duration) {
          q.shift();
        }
      }, function (e) { o.onError(e); }, function () {
        var now = scheduler.now(), res = [];
        while (q.length > 0) {
          var next = q.shift();
          now - next.interval <= duration && res.push(next.value);
        }
        o.onNext(res);
        o.onCompleted();
      });
    }, source);
  };

  /**
   *  Takes elements for the specified duration from the start of the observable source sequence, using the specified scheduler to run timers.
   *
   * @example
   *  1 - res = source.takeWithTime(5000,  [optional scheduler]);
   * @description
   *  This operator accumulates a queue with a length enough to store elements received during the initial duration window.
   *  As more elements are received, elements older than the specified duration are taken from the queue and produced on the
   *  result sequence. This causes elements to be delayed with duration.
   * @param {Number} duration Duration for taking elements from the start of the sequence.
   * @param {Scheduler} scheduler Scheduler to run the timer on. If not specified, defaults to Rx.Scheduler.timeout.
   * @returns {Observable} An observable sequence with the elements taken during the specified duration from the start of the source sequence.
   */
  observableProto.takeWithTime = function (duration, scheduler) {
    var source = this;
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    return new AnonymousObservable(function (o) {
      return new BinaryDisposable(scheduler.scheduleFuture(o, duration, function (_, o) { o.onCompleted(); }), source.subscribe(o));
    }, source);
  };

  /**
   *  Skips elements for the specified duration from the start of the observable source sequence, using the specified scheduler to run timers.
   * @description
   *  Specifying a zero value for duration doesn't guarantee no elements will be dropped from the start of the source sequence.
   *  This is a side-effect of the asynchrony introduced by the scheduler, where the action that causes callbacks from the source sequence to be forwarded
   *  may not execute immediately, despite the zero due time.
   *
   *  Errors produced by the source sequence are always forwarded to the result sequence, even if the error occurs before the duration.
   * @param {Number} duration Duration for skipping elements from the start of the sequence.
   * @param {Scheduler} scheduler Scheduler to run the timer on. If not specified, defaults to Rx.Scheduler.timeout.
   * @returns {Observable} An observable sequence with the elements skipped during the specified duration from the start of the source sequence.
   */
  observableProto.skipWithTime = function (duration, scheduler) {
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    var source = this;
    return new AnonymousObservable(function (o) {
      var open = false;
      return new BinaryDisposable(
        scheduler.scheduleFuture(null, duration, function () { open = true; }),
        source.subscribe(function (x) { open && o.onNext(x); }, function (e) { o.onError(e); }, function () { o.onCompleted(); }));
    }, source);
  };

  var SkipUntilWithTimeObservable = (function (__super__) {
    inherits(SkipUntilWithTimeObservable, __super__);
    function SkipUntilWithTimeObservable(source, startTime, scheduler) {
      this.source = source;
      this._st = startTime;
      this._s = scheduler;
      __super__.call(this);
    }

    function scheduleMethod(s, state) {
      state._open = true;
    }

    SkipUntilWithTimeObservable.prototype.subscribeCore = function (o) {
      this._open = false;
      return new BinaryDisposable(
        this._s.scheduleFuture(this, this._st, scheduleMethod),
        this.source.subscribe(new SkipUntilWithTimeObserver(o, this))
      );
    };

    return SkipUntilWithTimeObservable;
  }(ObservableBase));

  var SkipUntilWithTimeObserver = (function (__super__) {
    inherits(SkipUntilWithTimeObserver, __super__);

    function SkipUntilWithTimeObserver(o, p) {
      this._o = o;
      this._p = p;
      __super__.call(this);
    }

    SkipUntilWithTimeObserver.prototype.next = function (x) { this._p._open && this._o.onNext(x); };
    SkipUntilWithTimeObserver.prototype.error = function (e) { this._o.onError(e); };
    SkipUntilWithTimeObserver.prototype.completed = function () { this._o.onCompleted(); };

    return SkipUntilWithTimeObserver;
  }(AbstractObserver));


  /**
   *  Skips elements from the observable source sequence until the specified start time, using the specified scheduler to run timers.
   *  Errors produced by the source sequence are always forwarded to the result sequence, even if the error occurs before the start time.
   *
   * @examples
   *  1 - res = source.skipUntilWithTime(new Date(), [scheduler]);
   *  2 - res = source.skipUntilWithTime(5000, [scheduler]);
   * @param {Date|Number} startTime Time to start taking elements from the source sequence. If this value is less than or equal to Date(), no elements will be skipped.
   * @param {Scheduler} [scheduler] Scheduler to run the timer on. If not specified, defaults to Rx.Scheduler.timeout.
   * @returns {Observable} An observable sequence with the elements skipped until the specified start time.
   */
  observableProto.skipUntilWithTime = function (startTime, scheduler) {
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    return new SkipUntilWithTimeObservable(this, startTime, scheduler);
  };

  /**
   *  Takes elements for the specified duration until the specified end time, using the specified scheduler to run timers.
   * @param {Number | Date} endTime Time to stop taking elements from the source sequence. If this value is less than or equal to new Date(), the result stream will complete immediately.
   * @param {Scheduler} [scheduler] Scheduler to run the timer on.
   * @returns {Observable} An observable sequence with the elements taken until the specified end time.
   */
  observableProto.takeUntilWithTime = function (endTime, scheduler) {
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    var source = this;
    return new AnonymousObservable(function (o) {
      return new BinaryDisposable(
        scheduler.scheduleFuture(o, endTime, function (_, o) { o.onCompleted(); }),
        source.subscribe(o));
    }, source);
  };

  /**
   * Returns an Observable that emits only the first item emitted by the source Observable during sequential time windows of a specified duration.
   * @param {Number} windowDuration time to wait before emitting another item after emitting the last item
   * @param {Scheduler} [scheduler] the Scheduler to use internally to manage the timers that handle timeout for each item. If not provided, defaults to Scheduler.timeout.
   * @returns {Observable} An Observable that performs the throttle operation.
   */
  observableProto.throttle = function (windowDuration, scheduler) {
    isScheduler(scheduler) || (scheduler = defaultScheduler);
    var duration = +windowDuration || 0;
    if (duration <= 0) { throw new RangeError('windowDuration cannot be less or equal zero.'); }
    var source = this;
    return new AnonymousObservable(function (o) {
      var lastOnNext = 0;
      return source.subscribe(
        function (x) {
          var now = scheduler.now();
          if (lastOnNext === 0 || now - lastOnNext >= duration) {
            lastOnNext = now;
            o.onNext(x);
          }
        },function (e) { o.onError(e); }, function () { o.onCompleted(); }
      );
    }, source);
  };

  return Rx;
}));

// A "crossbar" is a class that provides structured notification registration.

DDPServer._Crossbar = function (options) {
  var self = this;
  options = options || {};

  self.nextId = 1;
  // map from collection name (string) -> listener id -> object. each object has
  // keys 'trigger', 'callback'.
  self.listenersByCollection = {};
  // For listeners without a string collection name in the trigger, map from
  // listener id -> {trigger, callback}.
  self.listenersWithoutCollection = {};
  self.factPackage = options.factPackage || "livedata";
  self.factName = options.factName || null;
};

_.extend(DDPServer._Crossbar.prototype, {
  // Listen for notification that match 'trigger'. A notification
  // matches if it has the key-value pairs in trigger as a
  // subset. When a notification matches, call 'callback', passing
  // the actual notification.
  //
  // Returns a listen handle, which is an object with a method
  // stop(). Call stop() to stop listening.
  //
  // XXX It should be legal to call fire() from inside a listen()
  // callback?
  listen: function (trigger, callback) {
    var self = this;
    var id = self.nextId++;
    var collection = null;  // save this in case trigger mutates
    var record = {trigger: EJSON.clone(trigger), callback: callback};
    if (typeof (trigger.collection) === 'string') {
      collection = trigger.collection;
      if (! _.has(self.listenersByCollection, collection)) {
        self.listenersByCollection[collection] = {};
      }
      self.listenersByCollection[collection][id] = record;
    } else {
      self.listenersWithoutCollection[id] = record;
    }

    if (self.factName && Package.facts) {
      Package.facts.Facts.incrementServerFact(
        self.factPackage, self.factName, 1);
    }

    return {
      stop: function () {
        if (self.factName && Package.facts) {
          Package.facts.Facts.incrementServerFact(
            self.factPackage, self.factName, -1);
        }
        if (collection === null) {
          delete self.listenersWithoutCollection[id];
        } else {
          delete self.listenersByCollection[collection][id];
          if (_.isEmpty(self.listenersByCollection[collection])) {
            delete self.listenersByCollection[collection];
          }
        }
      }
    };
  },

  // Fire the provided 'notification' (an object whose attribute
  // values are all JSON-compatibile) -- inform all matching listeners
  // (registered with listen()).
  //
  // If fire() is called inside a write fence, then each of the
  // listener callbacks will be called inside the write fence as well.
  //
  // The listeners may be invoked in parallel, rather than serially.
  fire: function (notification) {
    var self = this;
    // Listener callbacks can yield, so we need to first find all the ones that
    // match in a single iteration over self.listeners (which can't be mutated
    // during this iteration), and then invoke the matching callbacks, checking
    // before each call to ensure they haven't stopped.

    var matchingCallbacks = [];

    if (typeof (notification.collection) === 'string') {
      var collection = notification.collection;
      _.each(self.listenersByCollection[collection], function (l, id) {
        if (self._matches(notification, l.trigger)) {
          matchingCallbacks.push({id: id, collection: collection});
        }
      });
    } else {
      // Either no collection is specified, or a non-string collection. (In
      // practice this never happens.)  Check everything.
      _.each(self.listenersByCollection, function (byColl, collection) {
        _.each(byColl, function (l, id) {
          if (self._matches(notification, l.trigger)) {
            matchingCallbacks.push({id: id, collection: collection});
          }
        });
      });
      _.each(self.listenersWithoutCollection, function (l, id) {
        if (self._matches(notification, l.trigger)) {
          matchingCallbacks.push({id: id, collection: null});
        }
      });
    }

    _.each(matchingCallbacks, function (record) {
      self._fireCallback(notification, record.id, record.collection);
    });
  },

  _fireCallback: function (notification, id, collection) {
    var self = this;
    if (collection === null) {
      if (_.has(self.listenersWithoutCollection, id)) {
        self.listenersWithoutCollection[id].callback(notification);
      }
    } else {
      if (_.has(self.listenersByCollection, collection) &&
          _.has(self.listenersByCollection[collection], id)) {
        self.listenersByCollection[collection][id].callback(notification);
      }
    }
  },

  // A notification matches a trigger if all keys that exist in both are equal.
  //
  // Examples:
  //  N:{collection: "C"} matches T:{collection: "C"}
  //    (a non-targeted write to a collection matches a
  //     non-targeted query)
  //  N:{collection: "C", id: "X"} matches T:{collection: "C"}
  //    (a targeted write to a collection matches a non-targeted query)
  //  N:{collection: "C"} matches T:{collection: "C", id: "X"}
  //    (a non-targeted write to a collection matches a
  //     targeted query)
  //  N:{collection: "C", id: "X"} matches T:{collection: "C", id: "X"}
  //    (a targeted write to a collection matches a targeted query targeted
  //     at the same document)
  //  N:{collection: "C", id: "X"} does not match T:{collection: "C", id: "Y"}
  //    (a targeted write to a collection does not match a targeted query
  //     targeted at a different document)
  _matches: function (notification, trigger) {
    // Most notifications that use the crossbar have a string `collection` and
    // maybe an `id` that is a string or ObjectID. So let's fast-track "nope,
    // different collection" and "nope, different ID". This makes a noticeable
    // performance difference; see https://github.com/meteor/meteor/pull/3697
    if (typeof(notification.collection) === 'string' &&
        typeof(trigger.collection) === 'string' &&
        notification.collection !== trigger.collection) {
      return false;
    }
    if (typeof(notification.id) === 'string' &&
        typeof(trigger.id) === 'string' &&
        notification.id !== trigger.id) {
      return false;
    }
    if (notification.id instanceof LocalCollection._ObjectID &&
        trigger.id instanceof LocalCollection._ObjectID &&
        ! notification.id.equals(trigger.id)) {
      return false;
    }

    return _.all(trigger, function (triggerValue, key) {
      return !_.has(notification, key) ||
        EJSON.equals(triggerValue, notification[key]);
    });
  }
});

// The "invalidation crossbar" is a specific instance used by the DDP server to
// implement write fence notifications. Listener callbacks on this crossbar
// should call beginWrite on the current write fence before they return, if they
// want to delay the write fence from firing (ie, the DDP method-data-updated
// message from being sent).
DDPServer._InvalidationCrossbar = new DDPServer._Crossbar({
  factName: "invalidation-crossbar-listeners"
});

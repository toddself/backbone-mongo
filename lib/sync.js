// Generated by CoffeeScript 1.6.3
/*
  backbone-mongo.js 0.5.0
  Copyright (c) 2013 Vidigami - https://github.com/vidigami/backbone-mongo
  License: MIT (http://www.opensource.org/licenses/mit-license.php)
*/


(function() {
  var Backbone, Connection, DESTROY_BATCH_LIMIT, ModelCache, ModelTypeID, MongoCursor, MongoSync, QueryCache, Queue, Schema, Utils, moment, util, _;

  util = require('util');

  _ = require('underscore');

  Backbone = require('backbone');

  moment = require('moment');

  Queue = require('backbone-orm/lib/queue');

  Schema = require('backbone-orm/lib/schema');

  Utils = require('backbone-orm/lib/utils');

  QueryCache = require('backbone-orm/lib/cache/singletons').QueryCache;

  ModelCache = require('backbone-orm/lib/cache/singletons').ModelCache;

  ModelTypeID = require('backbone-orm/lib/cache/singletons').ModelTypeID;

  MongoCursor = require('./cursor');

  Connection = require('./connection');

  DESTROY_BATCH_LIMIT = 1000;

  module.exports = MongoSync = (function() {
    function MongoSync(model_type, sync_options) {
      this.model_type = model_type;
      this.sync_options = sync_options;
      this.model_type.model_name = Utils.findOrGenerateModelName(this.model_type);
      this.model_type.model_id = ModelTypeID.generate(this.model_type);
      this.schema = new Schema(this.model_type);
      this.backbone_adapter = this.model_type.backbone_adapter = this._selectAdapter();
    }

    MongoSync.prototype.initialize = function(model) {
      var url;
      if (this.is_initialized) {
        return;
      }
      this.is_initialized = true;
      this.schema.initialize();
      if (!(url = _.result(this.model_type.prototype, 'url'))) {
        throw new Error("Missing url for model");
      }
      return this.connect(url);
    };

    MongoSync.prototype.read = function(model, options) {
      if (model.models) {
        return this.cursor().toJSON(function(err, json) {
          if (err) {
            return options.error(err);
          }
          return options.success(json);
        });
      } else {
        return this.cursor(model.id).toJSON(function(err, json) {
          if (err) {
            return options.error(err);
          }
          if (!json) {
            return options.error(new Error("Model not found. Id " + model.id));
          }
          return options.success(json);
        });
      }
    };

    MongoSync.prototype.create = function(model, options) {
      var _this = this;
      if (this.manual_id && !model.id) {
        return options.error(new Error("Missing manual id for create: " + (util.inspect(model.attributes))));
      }
      return QueryCache.reset(this.model_type, function(err) {
        if (err) {
          return options.error(err);
        }
        return _this.connection.collection(function(err, collection) {
          var doc;
          if (err) {
            return options.error(err);
          }
          if (model.get('_rev')) {
            return options.error(new Error('New document has a non-empty revision'));
          }
          doc = _this.backbone_adapter.attributesToNative(model.toJSON());
          doc._rev = 1;
          return collection.insert(doc, function(err, docs) {
            if (err || !docs || docs.length !== 1) {
              return options.error(new Error("Failed to create model. Error: " + (err || 'document not found')));
            }
            return options.success(_this.backbone_adapter.nativeToAttributes(docs[0]));
          });
        });
      });
    };

    MongoSync.prototype.update = function(model, options) {
      var _this = this;
      if (!model.get('_rev')) {
        return this.create(model, options);
      }
      if (this.manual_id && !model.id) {
        return options.error(new Error("Missing manual id for create: " + (util.inspect(model.attributes))));
      }
      return QueryCache.reset(this.model_type, function(err) {
        if (err) {
          return options.error(err);
        }
        return _this.connection.collection(function(err, collection) {
          var changes, find_query, json, key, keys_to_delete, modifications, value, _i, _len;
          if (err) {
            return options.error(err);
          }
          json = _this.backbone_adapter.attributesToNative(model.toJSON());
          if (_this.backbone_adapter.id_attribute === '_id') {
            delete json._id;
          }
          find_query = _this.backbone_adapter.modelFindQuery(model);
          find_query._rev = json._rev;
          json._rev++;
          modifications = {
            $set: json
          };
          if (changes = model.changedAttributes()) {
            keys_to_delete = [];
            for (key in changes) {
              value = changes[key];
              if (_.isUndefined(value)) {
                keys_to_delete.push(key);
              }
            }
            if (keys_to_delete.length) {
              modifications.$unset = {};
              for (_i = 0, _len = keys_to_delete.length; _i < _len; _i++) {
                key = keys_to_delete[_i];
                modifications.$unset[key] = '';
              }
            }
          }
          return collection.findAndModify(find_query, [[_this.backbone_adapter.id_attribute, 'asc']], modifications, {
            "new": true
          }, function(err, doc) {
            if (err) {
              return options.error(new Error("Failed to update model. Error: " + err));
            }
            if (!doc) {
              return options.error(new Error("Failed to update model. Either the document has been deleted or the revision (_rev) was stale."));
            }
            if (doc._rev !== json._rev) {
              return options.error(new Error("Failed to update revision. Is: " + doc._rev + " expecting: " + json._rev));
            }
            return options.success(_this.backbone_adapter.nativeToAttributes(doc));
          });
        });
      });
    };

    MongoSync.prototype["delete"] = function(model, options) {
      var _this = this;
      return QueryCache.reset(this.model_type, function(err) {
        if (err) {
          return options.error(err);
        }
        return _this.connection.collection(function(err, collection) {
          if (err) {
            return options.error(err);
          }
          return collection.remove(_this.backbone_adapter.attributesToNative({
            id: model.id
          }), function(err) {
            if (err) {
              return options.error(err);
            }
            return options.success();
          });
        });
      });
    };

    MongoSync.prototype.resetSchema = function(options, callback) {
      var queue,
        _this = this;
      queue = new Queue();
      queue.defer(function(callback) {
        return _this.collection(function(err, collection) {
          if (err) {
            return callback(err);
          }
          return collection.remove(function(err) {
            if (options.verbose) {
              if (err) {
                console.log("Failed to reset collection: " + collection.collectionName + ". Error: " + err);
              } else {
                console.log("Reset collection: " + collection.collectionName);
              }
            }
            return callback(err);
          });
        });
      });
      queue.defer(function(callback) {
        var key, relation, schema, _ref;
        schema = _this.model_type.schema();
        _ref = schema.relations;
        for (key in _ref) {
          relation = _ref[key];
          if (relation.type === 'hasMany' && relation.reverse_relation.type === 'hasMany') {
            (function(relation) {
              return queue.defer(function(callback) {
                return relation.findOrGenerateJoinTable().resetSchema(callback);
              });
            })(relation);
          }
        }
        return callback();
      });
      return queue.await(callback);
    };

    MongoSync.prototype.cursor = function(query) {
      if (query == null) {
        query = {};
      }
      return new MongoCursor(query, _.pick(this, ['model_type', 'connection', 'backbone_adapter']));
    };

    MongoSync.prototype.destroy = function(query, callback) {
      var _this = this;
      return QueryCache.reset(this.model_type, function(err) {
        if (err) {
          return callback(err);
        }
        return _this.connection.collection(function(err, collection) {
          if (err) {
            return callback(err);
          }
          return _this.model_type.each(_.extend({
            $each: {
              limit: DESTROY_BATCH_LIMIT,
              json: true
            }
          }, query), (function(model_json, callback) {
            return Utils.patchRemoveByJSON(_this.model_type, model_json, function(err) {
              if (err) {
                return callback(err);
              }
              return collection.remove(_this.backbone_adapter.attributesToNative({
                id: model_json.id
              }), function(err) {
                if (err) {
                  return callback(err);
                }
                return callback();
              });
            });
          }), callback);
        });
      });
    };

    MongoSync.prototype.connect = function(url) {
      if (this.connection && this.connection.url === url) {
        return;
      }
      if (this.connection) {
        this.connection.destroy();
      }
      return this.connection = new Connection(url, this.schema, this.sync_options.connection_options || {});
    };

    MongoSync.prototype.collection = function(callback) {
      return this.connection.collection(callback);
    };

    MongoSync.prototype._selectAdapter = function() {
      var field_info, field_name, info, schema, _i, _len;
      schema = _.result(this.model_type, 'schema') || {};
      for (field_name in schema) {
        field_info = schema[field_name];
        if ((field_name !== 'id') || !_.isArray(field_info)) {
          continue;
        }
        for (_i = 0, _len = field_info.length; _i < _len; _i++) {
          info = field_info[_i];
          if (info.manual_id) {
            this.manual_id = true;
            return require('./document_adapter_no_mongo_id');
          }
        }
      }
      return require('./document_adapter_mongo_id');
    };

    return MongoSync;

  })();

  module.exports = function(type, sync_options) {
    var model_type, sync, sync_fn;
    if (sync_options == null) {
      sync_options = {};
    }
    if (Utils.isCollection(new type())) {
      model_type = Utils.configureCollectionModelType(type, module.exports);
      return type.prototype.sync = model_type.prototype.sync;
    }
    sync = new MongoSync(type, sync_options);
    type.prototype.sync = sync_fn = function(method, model, options) {
      if (options == null) {
        options = {};
      }
      sync.initialize();
      if (method === 'createSync') {
        return module.exports.apply(null, Array.prototype.slice.call(arguments, 1));
      }
      if (method === 'sync') {
        return sync;
      }
      if (method === 'schema') {
        return sync.schema;
      }
      if (method === 'isRemote') {
        return false;
      }
      if (sync[method]) {
        return sync[method].apply(sync, Array.prototype.slice.call(arguments, 1));
      } else {
        return void 0;
      }
    };
    require('backbone-orm/lib/extensions/model')(type);
    return ModelCache.configureSync(type, sync_fn);
  };

}).call(this);
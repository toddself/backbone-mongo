util = require 'util'
_ = require 'underscore'
Queue = require 'queue-async'

DatabaseUrl = require 'backbone-orm/lib/database_url'
ConnectionPool = require 'backbone-orm/lib/connection_pool'

MongoClient = require('mongodb').MongoClient

QUERY_OPTIONS = ['autoReconnect', 'maxPoolSize']

module.exports = class Connection
  @options = {}

  constructor: (@url, @schema={}, options={}) ->
    throw new Error 'Expecting a string url' unless _.isString(@url)
    connection_options = _.extend(_.clone(Connection.options), options)

    @collection_requests = []
    @db = null
    database_url = new DatabaseUrl(@url, true)
    collection_name = database_url.table

    # configure query options and regenerate URL
    database_url.query or= {}; delete database_url.search
    for key in QUERY_OPTIONS
      (database_url.query[key] = connection_options[key]; delete connection_options[key]) if connection_options.hasOwnProperty(key)
    @url = database_url.format({exclude_table: true})

    queue = Queue(1)

    # use pooled connection or create new
    queue.defer (callback) =>
      return callback() if @db = ConnectionPool.get(@url)

      MongoClient.connect @url, connection_options, (err, db) =>
        return callback(err) if err

        # it may have already been connected to asynchronously, release new
        if @db = ConnectionPool.get(@url) then db.close() else ConnectionPool.set(@url, @db = db)
        callback()

    # get the collection
    queue.defer (callback) =>
      @db.collection collection_name, (err, collection) =>
        @_collection = collection unless err
        callback(err)

        # ensure indexes asyncronously
        @ensureIndex(key, collection_name) for key, field of @schema.fields when field.indexed
        @ensureIndex(relation.foreign_key, collection_name) for key, relation of @schema.relations when relation.type is 'belongsTo' and not relation.isVirtual() and not relation.isEmbedded()

    # process awaiting requests
    queue.await (err) =>
      collection_requests = _.clone(@collection_requests); @collection_requests = []
      if @failed_connection = !!err
        console.log "Backbone-Mongo: unable to create connection. Error: #{err}"
        request(new Error 'Connection failed') for request in collection_requests
      else
        request(null, @_collection) for request in collection_requests

  destroy: ->
    return unless @db # already closed
    collection_requests = _.clone(@collection_requests); @collection_requests = []
    request(new Error('Client closed')) for request in collection_requests
    @_collection = null
    @db.close(); @db = null

  collection: (callback) ->
    return callback(new Error('Connection failed')) if @failed_connection
    return callback(null, @_collection) if @_collection
    @collection_requests.push(callback)

  ensureIndex: (field_name, table_name) =>
    index_info = {}; index_info[field_name] = 1
    @_collection.ensureIndex index_info, {background: true}, (err) =>
      return new Error("MongoBackbone: Failed to indexed '#{field_name}' on #{table_name}. Reason: #{err}") if err
      console.log("MongoBackbone: Successfully indexed '#{field_name}' on #{table_name}")

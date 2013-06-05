_ = require 'underscore'
Queue = require 'queue-async'
mongodb = require 'mongodb'
util = require 'util'
URL = require 'url'

# two minutes
RETRY_COUNT = 120
RETRY_INTERVAL = 1000

connectionRetry = (retry_count, name, fn, callback) ->
  attempt_count = 0
  in_attempt = false

  call_fn = ->
    return _.delay(call_fn, RETRY_INTERVAL/2) if in_attempt # trying so try again in 1/2 the time
    in_attempt = true; attempt_count++
    console.log "***retrying #{name}. Attempt: #{attempt_count}" if attempt_count > 1
    fn (err) ->
      if err
        (in_attempt = false; return _.delay(call_fn, RETRY_INTERVAL)) if (attempt_count < retry_count) # try again

      console.log "***retried #{name} #{attempt_count} times. Success: '#{!err}'" if attempt_count > 1
      return callback.apply(null, arguments)
  call_fn()

module.exports = class Connection

  constructor: (@url, schema={}) ->
    @collection_requests = []
    throw new Error "Expecting a string url" unless _.isString(@url)
    url_parts = URL.parse(@url)
    config =
      host: url_parts.hostname
      port: url_parts.port
    if url_parts.auth
      auth_parts = url_parts.auth.split(':')
      config.user = auth_parts[0]
      config.password = auth_parts[1]

    database_parts = url_parts.path.split('/')
    database = database_parts[1]
    collection = database_parts[2]

    console.log "MongoDB for '#{collection}' is: '#{config.host}:#{config.port}/#{database}'"
    @client = new mongodb.Db(database, new mongodb.Server(config.host, config.port, {}), {safe: true})

    queue = Queue(1)
    queue.defer (callback) =>
      doOpen = (callback) => @client.open callback

      # socket retries
      connectionRetry(RETRY_COUNT, "MongoDB client open: #{collection}", doOpen, callback)

    queue.defer (callback) =>
      if config.user
        @client.authenticate(config.user, config.password, callback)
      else
        callback()

    queue.defer (callback) =>

      doConnectToCollection = (callback) =>
        @client.collection collection, (err, collection) =>
          return callback(err) if err

          # TODO: map indices
          # if options.indices
          #   console.log("Trying to ensureIndex #{util.inspect(options.indices)} on #{collection}")
          #   collection.ensureIndex options.indices, {background: true}, (err) =>
          #     return new Error("Failed to ensureIndex #{util.inspect(options.indices)} on #{collection}. Reason: #{err}") if err
          #     console.log("Successfully ensureIndex #{util.inspect(options.indices)} on #{collection}")

          # deal with waiting requests
          collection_requests = _.clone(@collection_requests); @collection_requests = []
          @_collection = collection
          request(null, @_collection) for request in collection_requests
          callback()

      # socket retries
      connectionRetry(RETRY_COUNT, "MongoDB collection connect: #{collection}", doConnectToCollection, callback)

    queue.await (err) =>
      if err
        @failed_connection = true
        collection_requests = _.clone(@collection_requests)
        @collection_requests = []
        request(new Error("Connection failed")) for request in collection_requests

  collection: (callback) ->
    return callback(new Error("Client closed")) unless @client
    return callback(new Error("Connection failed")) if @failed_connection
    return callback(null, @_collection) if @_collection
    @collection_requests.push(callback)

  ##
  # Close the database connection
  ##
  close: () ->
    return unless @client # already closed
    collection_requests = _.clone(@collection_requests); @collection_requests = []
    request(new Error("Client closed")) for request in collection_requests
    @_collection = null
    @client.close(); @client = null
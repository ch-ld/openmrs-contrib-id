var Sequelize = require('sequelize'),
	Common = require('./openmrsid-common'),
	conf = Common.conf,
	log = Common.logger.add('database');
	
var sql = new Sequelize(conf.db.dbname, conf.db.username, conf.db.password, {
		logging: false
	}),
	models = [];

// Expose Datatypes	
exports.STRING = Sequelize.STRING;
exports.TEXT = Sequelize.TEXT;
exports.INTEGER = Sequelize.INTEGER;
exports.DATE = Sequelize.DATE;
exports.BOOLEAN = Sequelize.BOOLEAN;
exports.FLOAT = Sequelize.FLOAT;


/*
EXPOSED DATA METHODS
====================
*/

// allows models to be defined externally (used for modules)
exports.define = function(name, properties, methods, callback) {
	// Check for model name collision
	if (models[name]) return callback(new Error('A model "'+name+'" already exists.'));
	
	// Check arguments
	var a = arguments;
	if (typeof a[2] == 'object') { // If methods are passed
		var callback = (typeof a[3] == 'function') ? a[3] : new Function // If callback is defined
	}
	else if (typeof a[2] == 'function') { // If methods are not passed
		var callback = a[2];
		var methods = {};
	}
	else {
		var methods = {};
		var callback = function(err){if(err) log.error(err)};
	}
	
	// define the model in Sequelize (synchronous)
	models[name] = sql.define(name, properties, methods);
		
	// Sync new model to database and callback
	models[name].sync().success(function() {
		log.debug('Model "'+name+'" defined and synced.');
		return callback();
	}).error(function(err){
		return callback(err);
	});
};

// get a new instance of a model, ready to accept attributes
exports.create = function(model) {
	if (!models[model]) {
		log.warn("Requested model "+model+" doesn't exist.");
		return;
	}
	
	log.trace('building new instance of '+model);
	var instance = models[model].build();
	
	// custom creation paramaters
	if (instance.onCreate) instance.onCreate(instance);
	
	return instance;
}

// take an array of instance values, and push to db ONLY IF model's table is empty
exports.initiate = function(model, defaults, callback) {
	log.trace('initiate called');
	if (!models[model]) {
		log.warn("Requested model "+model+" doesn't exist.");
		return;
	}
	if (!callback) callback = function(err){if(err) log.error(err)};
	
	// get all instances of model and do not initiate if any already exist
	exports.getAll(model, function(err, instances) {
		if (err) return callback(err);
		if (instances.length == 0) {
			log.debug('initiating '+model);
		
			// prepare each entry to initiate
			var chain = []; // chain to save to
			defaults.forEach(function(entry){
				var inst = models[model].build(); // define instance to build on to
				for (key in entry) {
					inst[key] = entry[key]; // set instance value to passed value
				}
				chain.push(inst);
			});
			
			exports.chainSave(chain, function(err){
				if (err) return callback(err);
				callback(); // all done!
			});
		}
		else callback(); // finish doing nothing if model doesn't need initiation
	});
	
}

// send an updated instance back to the DB, optionally only updating certain attributes
exports.update = function(instance, attrs, callback) {
	log.trace('updating instance of '+instance.__factory.name)
	// detect whether attrs & callback are present
	if (arguments[1] && arguments[1].constructor == Array) attrs = arguments[1]; // if array, those are the attrs
		else if (arguments[1].constructor == Function) {callback = arguments[1]; attrs = null;}
	if (arguments[2] && arguments[2].constructor == Function) callback = arguments[2];
	if (!callback) callback = new Function;
	
	// data housekeeping
	if (instance.onSave) instance.onSave(instance);
	
	instance.save(attrs).success(function(){
		log.trace('instance saved & updated');
		callback(null, instance);
	}).error(function(err){
		callback(err);
	});
	
}

// find and retreive instance(s) from DB based on search criteria
// criteria example: {name: 'A Project', id: [1,2,3]}
exports.find = function(model, criteria, callback) {
	if (!models[model]) return callback(new Error("Requested model doesn't exist."));
	
	// findAll will return an array of multiple results
	models[model].findAll({where: criteria}).success(function(instances){
		instances.forEach(function(item) {
			if (item.onGet) item.onGet(item);
		});
		callback(null, instances);
	}).error(function(err){
		callback(err);
	});
};

// get instance by id
exports.get = function(model, id, callback) {
	if (!models[model]) return callback(new Error("Requested model doesn't exist."));
	
	models[model].find(id).success(function(instance){
		if (instance.onGet) instance.onGet(instance);
		callback(null, instance);
	}).error(function(err){
		callback(err);
	});
}; 

// get all instances from a model, returned in array
exports.getAll = function(model, callback) {
	if (!models[model]) return callback(new Error("Requested model doesn't exist."));
	
	models[model].findAll().success(function(instances){
		instances.forEach(function(item) {
			if (item.onGet) item.onGet(item)
		});
		callback(null, instances);
	}).error(function(err){
		callback(err);
	});	
};

// retrieve a single instance, or create a new model with supplied criteria
exports.findOrCreate = function(model, criteria, callback) {
	log.trace('looking for '+model+' instance with '+JSON.stringify(criteria));
	exports.find(model, criteria, function(err, instances){
		if (err) callback(err);
		else {
			if (instances.length == 0) { // need to create a new model
				var created = exports.create(model);
				for (prop in criteria) { // apply criteria properties to new instance
					created[prop] = criteria[prop];
				}
				if (created.onCreate) created.onCreate(created);
				callback(null, created); // return new instance
				log.trace('new instance of '+model+' created');
			}
			else {
				if (instances[0].onGet) instances[0].onGet(instances[0]);
				callback(null, instances[0]); // return found instance
			}
		}
	})
}

// save an array of instances through a chain query
exports.chainSave = function(array, callback) {
	var chainer = new Sequelize.Utils.QueryChainer;
	array.forEach(function(member){
		if (member.onSave) member.onSave(member);
		chainer.add(member.save());
		log.trace('adding '+member.address+' to chain-op');
	});
	chainer.run().success(function(){
		log.trace('chain save completed');
		return callback();
	}).error(function(errors){
		return callback(errors);
	})
}

// drop instance from DB
exports.drop = function(instance, callback) {
	if (!callback) callback = function(err){if(err) log.error(err)}
	log.trace('destroying instance of '+instance.__factory.name);
	instance.destroy().success(function(u){
		log.trace('dropped instance from DB');
		return callback();
	}).error(function(err){
		return callback(err);
	});
}


// sync DB table (simply exposes from internals)
exports.sync = function(model, options, callback) {
	if (!models[model]) throw (new Error("Requested model doesn't exist."));
	models[model].sync(options).success(function(){
		callback();
	}).error(function(err){
		callback(err);
	});
}




/*
STORAGE MODEL
============
*/

/* additional instance methods:
	- onGet, onSave, onCreate: synchronous, each passed a copy of its own instance
*/

models.EmailVerification = sql.define('EmailVerification', {
	verifyId: {type: Sequelize.STRING, unique: true, primaryKey: true},
	actionId: {type: Sequelize.STRING, unique: true},
	urlBase: {type: Sequelize.STRING},
	email: {type: Sequelize.STRING},
	associatedId: {type: Sequelize.STRING},
	locals: {type: Sequelize.TEXT, defaultValue: null},
	settings: {type: Sequelize.TEXT, defaultValue: null},
	timeoutDate: {type: Sequelize.DATE, defaultValue: null}
}, {instanceMethods: {
	onSave: function(instance) {
		// objects to strings, etc
		if (typeof instance.locals == 'object') instance.locals = JSON.stringify(instance.locals);
		if (typeof instance.settings == 'object') instance.settings = JSON.stringify(instance.settings);
	},
	onGet: function(instance) {
		if (typeof instance.locals == 'string') instance.locals = JSON.parse(instance.locals);
		if (typeof instance.settings == 'string') instance.settings = JSON.parse(instance.settings);
	}

}});

models.Conf = sql.define('Conf', {
	id: {type: Sequelize.STRING, unique: false, primaryKey: true, autoIncrement: true},
	parent: {type: Sequelize.STRING, allowNull: false},
	key: {type: Sequelize.STRING, allowNull: false},
	value: {type: Sequelize.STRING, allowNull: false}
});



// SYNC (on startup)
sql.sync().success(function(){
	log.info('Data models synced & ready.');
}).error(function(err){
	log.error('sync error: ');
	log.error(err);
})





// TESTING

/*
exports.find('Test', {name: 'hello world'}, function(err, data) {
	if (err) console.log(err);
	else console.log(data.__factory.name);
	
});
*/

/*
models.Test = sql.define('SequelizeTest', {
	id: {type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true},
	name: {type: Sequelize.STRING},
});

models.Test.sync().success(function(){
	console.log('successful sync!');

	var test = models.Test.build({
		name: 'another test'
	});
	var test = models.Test.build();
	
	test.name = 'Try something new.';
	test.save().success(function(){
		console.log('saved!');
	});
	
	
	models.Test.find(2).success(function(result){
		result.name = 'another PRESSED';
		result.save();
	});


}).error(function(err){
	console.log('sync fail :(');
	console.log(err);
});
*/
var cluster = require("cluster");
var events = require("events");
var phantom = require("phantom");
var os = require("os");

var Master = function (options) {
    events.EventEmitter.call(this);
    
    this.isMaster = true;
    this.running = true;
    
    this.workerCount = options && options.workerCount || os.cpus().length;
    this.workerQueue = [];
    
    this.itemTimeout = options && options.pageDeath || 120000;
    this.itemClicker = 0;
    this.itemQueue = [];
    this.items = {};
    
    cluster.on("exit", this.onExit.bind(this));
    
    this.start();
};

Master.prototype = Object.create(events.EventEmitter.prototype);

Master.prototype.onMessage = function (msg) {
    switch (msg.action) {
        case "ready": {
            this.workerQueue.push(cluster.workers[msg.id]);
            this.process();
            break;
        }
        case "done": {
            if (msg.item = this.items[msg.id]) {
                clearTimeout(msg.item.timeout);
                msg.item.done(msg.err, msg.data);
                delete this.items[msg.id];
            }
            break;
        }
    }
};

Master.prototype.onTimeout = function (worker, id) {
    var item = this.items[id];
    
    worker.send({
        action: "cancel",
        id: id
    });
    
    delete this.items[id];
    this.queue(item.data, item.done);
};

Master.prototype.onExit = function (worker) {
    Object.keys(this.items).forEach(function (id) {
        var item = this.items[id];
        
        if (item.worker === worker.id) {
            clearTimeout(item.timeout);
            delete this.items[id];
            this.queue(item.data, item.done);
        }
    }.bind(this));
    
    if (this.running) {
        cluster.fork().on("message", this.onMessage.bind(this));
    }
};

Master.prototype.start = function () {
    this.running = true;
    
    for (var i = this.workerCount; i--;) {
        this.onExit({});
    }
};

Master.prototype.stop = function () {
    this.running = false;
    
    for (var key in cluster.workers) {
        cluster.workers[key].kill();
    }
};

Master.prototype.queue = function (data, next) {
    var item = {
        id: this.itemClicker++,
        timeout: -1,
        data: data,
        done: next
    };
    
    this.itemQueue.push(item);
    this.process();
};

Master.prototype.process = function () {
    while (this.workerQueue.length && this.itemQueue.length) {
        var worker = this.workerQueue.shift();
        var item = this.itemQueue.shift();
        
        item.worker = worker.id;
        item.timeout = setTimeout(this.onTimeout.bind(this, worker, item.id), this.itemTimeout);
        this.items[item.id] = item;
        
        worker.send({
            action: "process",
            id: item.id,
            data: item.data
        });
    }
};

var Worker = function (options) {
    events.EventEmitter.call(this);  
    
    this.isMaster = false;
    
    this.pageDeath = options && options.workerDeath || 20;
    this.pageCount = options && options.pageCount || 1;
    this.pageClicker = 0;
    this.pages = {};
    
    phantom.create.apply(phantom, (options && options.phantomFlags || []).concat({
        binary: options && options.phantomBinary,
        port: (options && options.phantomPort || 12300) + (cluster.worker.id % 200),
        onExit: process.exit
    }, function (proc) {
        this.phantom = proc;
        
        for (var i = this.pageCount; i--;) {
            this.done();
        }
    }.bind(this)));
    
    process.on("message", this.onMessage.bind(this));
};

Worker.prototype = Object.create(events.EventEmitter.prototype);

Worker.prototype.onMessage = function (msg) {
    switch (msg.action) {
        case "process": {
            this.phantom.createPage(function (page) {
                this.pageClicker++;
                this.pages[msg.id] = page;
                this.emit("queue", page, msg.data, this.done.bind(this, msg.id));
            }.bind(this));
            break;
        }
        case "cancel": {
            delete this.pages[msg.id];
            break;
        }
    }
};

Worker.prototype.done = function (id, err, data) {
    if (!this.pages[id]) {
        return process.send({
            action: "ready",
            id: cluster.worker.id
        });
    }
    
    this.pages[id].close();
    delete this.pages[id];
    
    process.send({
        action: "done",
        id: id,
        err: err,
        data: data
    });
    
    if (this.pageClicker < this.pageDeath) {
        process.send({
            action: "ready",
            id: cluster.worker.id
        });
    } else if (!Object.keys(this.pages).length) {
        process.exit();
    }
};

module.exports = function (options) {
    return cluster.isMaster ? new Master(options) : new Worker(options);
};
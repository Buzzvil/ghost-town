var cluster = require("cluster");
var events = require("events");
var phantom = require("phantom");

var is = function (type, val, def) {
    return val !== null && typeof val === type ? val : def;
};

var Master = function (opts) {
    opts = is("object", opts, {});
    
    events.EventEmitter.call(this);
    
    this.isMaster = true;
    this.isRunning = false;
    
    this._workerCount = is("number", opts.workerCount, 4);
    this._workerQueue = [];
    
    this._itemTimeout = is("number", opts.pageDeath, 30000);
    this._itemRetries = is("number", opts.pageTries, -1);
    this._itemClicker = 0;
    this._itemQueue = [];
    this._items = {};
    
    cluster.on("exit", this._onExit.bind(this));
    
    this.start();
};

Master.prototype = Object.create(events.EventEmitter.prototype);

Master.prototype._onMessage = function (msg) {
    if (is("object", msg, {}).ghost !== "town") {
        return;
    }
    
    var item = this._items[msg.id];
    if (item) {
        delete this._items[msg.id];
        clearTimeout(item.timeout);
        item.done(msg.err, msg.data);
    }
    
    this._workerQueue.push(cluster.workers[msg.worker]);
    this._process();
};

Master.prototype._onTimeout = function (item) {
    delete this._items[item.id];
    
    if (item.retries === this._itemRetries) {
        item.done(new Error("[ghost-town] max pageTries"));
    } else {
        this.queue(item.data, true, item.done, item.retries + 1);
    }
};

Master.prototype._onExit = function (worker) {
    for (var id in this._items) {
        var item = this._items[id];
        
        if (item.worker === worker) {
            delete this._items[id];
            clearTimeout(item.timeout);
            this.queue(item.data, true, item.done, item.retries);
        }
    }
    if(worker){
        var index = this._workerQueue.findIndex((x)=>{return (x.id===worker.id)})
        if(index>=0)
            this._workerQueue.splice(index,1)
    }
    
    if (this.isRunning) {
        cluster.fork().on("message", this._onMessage.bind(this));
    }
};

Master.prototype.start = function () {
    if (this.isRunning) {
        return;
    }
    
    this.isRunning = true;
    
    for (var i = this._workerCount; i--;) {
        this._onExit();
    }
};

Master.prototype.stop = function () {
    this.isRunning = false;
    
    for (var key in cluster.workers) {
        cluster.workers[key].kill();
    }
};

Master.prototype.queue = function (data, asap, next, tries) {
    var item = {
        id: this._itemClicker++,
        timeout: -1,
        retries: tries || 0,
        data: data,
        done: next || asap
    };
    
    this._itemQueue[next && asap ? "unshift" : "push"](item);
    this._process();
};

Master.prototype._process = function () {
    while (this._workerQueue.length && this._itemQueue.length) {
        var worker = this._workerQueue.shift();
        
        if (!worker || !worker.process.connected) {
            continue;
        }
        
        var item = this._itemQueue.shift();
        
        item.worker = worker;
        item.timeout = setTimeout(this._onTimeout.bind(this, item), this._itemTimeout);
        this._items[item.id] = item;
        
        worker.send({
            ghost: "town",
            id: item.id,
            data: item.data
        });
    }
};

var Worker = function (opts) {
    opts = is("object", opts, {});
    
    events.EventEmitter.call(this);  
    
    this.isMaster = false;
    
    this._workerDeath = is("number", opts.workerDeath, 25);
    this._workerShift = is("number", opts.workerShift, -1);
    
    this._pageCount = is("number", opts.pageCount, 1);
    this._pageClicker = 0;
    this._pages = {};
    
    phantom.create({
        parameters: opts.phantomFlags,
        binary: opts.phantomBinary,
        port: is("number", opts.phantomPort, 12300) + (cluster.worker.id % 200),
        onStdout: function () {},
        onStderr: function () {},
        onExit: process.exit
    }, function (proc) {
        this.phantom = proc;
        
        for (var i = this._pageCount; i--;) {
            process.send({
                ghost: "town",
                worker: cluster.worker.id
            });
        }
    }.bind(this));
    
    process.on("message", this._onMessage.bind(this));
    
    if (this._workerShift !== -1) {
        setTimeout(process.exit, this._workerShift);
    }
};

Worker.prototype = Object.create(events.EventEmitter.prototype);

Worker.prototype._onMessage = function (msg) {
    if (is("object", msg, {}).ghost !== "town") {
        return;
    }
    
    this.phantom.createPage(function (page) {
        this._pageClicker++;
        this._pages[msg.id] = page;
        this.emit("queue", page, msg.data, this._done.bind(this, msg.id));
    }.bind(this));
};

Worker.prototype._done = function (id, err, data) {
    if (!this._pages[id]) {
        return;
    }
    
    this._pages[id].close();
    delete this._pages[id];
    
    process.send({
        ghost: "town",
        worker: cluster.worker.id,
        id: id,
        err: err,
        data: data
    });
    
    if (this._pageClicker >= this._workerDeath) {
        process.exit();
    }
};

module.exports = function (opts) {
    return cluster.isMaster ? new Master(opts) : new Worker(opts);
};
var cluster = require("cluster");
var events = require("events");
var phantom = require("phantom");
var os = require("os");

var is = function (type, val, def) {
    return typeof val === type ? val : def;
};

var Master = function (opts) {
    opts = is("object", opts, {});
    
    events.EventEmitter.call(this);
    
    this.isMaster = true;
    this.running = false;
    
    this._workerCount = is("number", opts.workerCount, os.cpus().length);
    this._workerQueue = [];
    
    this._itemTimeout = is("number", opts.pageDeath, 120000);
    this._itemRetries = is("number", opts.pageTries, -1);
    this._itemClicker = 0;
    this._itemQueue = [];
    this._items = {};
    
    cluster.on("exit", this._onExit.bind(this));
    
    this.start();
};

Master.prototype = Object.create(events.EventEmitter.prototype);

Master.prototype._onMessage = function (msg) {
    switch (msg.action) {
        case "ready": {
            this._workerQueue.push(cluster.workers[msg.id]);
            this._process();
            
            break;
        }
        case "done": {
            if (this._items[msg.id]) {
                clearTimeout(this._items[msg.id].timeout);
                this._items[msg.id].done(msg.err, msg.data);
                delete this._items[msg.id];
            }
            
            break;
        }
    }
};

Master.prototype._onTimeout = function (item) {
    item.worker.send({
        action: "cancel",
        id: item.id
    });
    
    delete this._items[item.id];
    
    if (item.retries === this._itemRetries) {
        item.done(new Error("[ghost-town] max pageTries"));
    } else {
        this.queue(item.data, item.done, item.retries + 1);
    }
};

Master.prototype._onExit = function (worker) {
    for (var id in this._items) {
        var item = this._items[id];
        
        if (item.worker === worker) {
            clearTimeout(item.timeout);
            delete this._items[id];
            this.queue(item.data, item.done, item.retries);
        }
    }
    
    if (this.running) {
        cluster.fork().on("message", this._onMessage.bind(this));
    }
};

Master.prototype.start = function () {
    if (this.running) {
        return;
    }
    
    this.running = true;
    
    for (var i = this._workerCount; i--;) {
        this._onExit({});
    }
};

Master.prototype.stop = function () {
    this.running = false;
    
    for (var key in cluster.workers) {
        cluster.workers[key].kill();
    }
};

Master.prototype.queue = function (data, next, tries) {
    var item = {
        id: this._itemClicker++,
        timeout: -1,
        retries: tries || 0,
        data: data,
        done: next
    };
    
    this._itemQueue.push(item);
    this._process();
};

Master.prototype._process = function () {
    while (this._workerQueue.length && this._itemQueue.length) {
        var worker = this._workerQueue.shift();
        
        if (!worker.process.connected) {
            continue;
        }
        
        var item = this._itemQueue.shift();
        
        item.worker = worker;
        item.timeout = setTimeout(this._onTimeout.bind(this, item), this._itemTimeout);
        this._items[item.id] = item;
        
        worker.send({
            action: "process",
            id: item.id,
            data: item.data
        });
    }
};

var Worker = function (opts) {
    opts = is("object", opts, {});
    
    events.EventEmitter.call(this);  
    
    this.isMaster = false;
    
    this._pageDeath = is("number", opts.workerDeath, 20);
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
            this._done();
        }
    }.bind(this));
    
    process.on("message", this._onMessage.bind(this));
};

Worker.prototype = Object.create(events.EventEmitter.prototype);

Worker.prototype._onMessage = function (msg) {
    switch (msg.action) {
        case "process": {
            this.phantom.createPage(function (page) {
                this._pageClicker++;
                this._pages[msg.id] = page;
                this.emit("queue", page, msg.data, this._done.bind(this, msg.id));
            }.bind(this));
            
            break;
        }
        case "cancel": {
            delete this._pages[msg.id];
            
            break;
        }
    }
};

Worker.prototype._done = function (id, err, data) {
    if (!this._pages[id]) {
        return process.send({
            action: "ready",
            id: cluster.worker.id
        });
    }
    
    this._pages[id].close();
    delete this._pages[id];
    
    process.send({
        action: "done",
        id: id,
        err: err,
        data: data
    });
    
    if (this._pageClicker < this._pageDeath) {
        process.send({
            action: "ready",
            id: cluster.worker.id
        });
    } else if (!Object.keys(this._pages).length) {
        process.exit();
    }
};

module.exports = function (opts) {
    return cluster.isMaster ? new Master(opts) : new Worker(opts);
};
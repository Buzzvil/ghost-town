"use strict";

const cluster = require("recluster");
const events = require("events");
const phantom = require("phantom");

function is (type, val, def) {
    return val !== null && typeof val === type ? val : def;
}

class Master extends events.EventEmitter {
    constructor (opts) {
        opts = is("object", opts, {});
        
        super();
        
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
        
        !opts.deferStart &&  this.start();
    }
    
    _onMessage (msg) {
        if (is("object", msg, {}).ghost !== "town") {
            return;
        }
        
        const item = this._items[msg.id];
        
        if (item) {
            delete this._items[msg.id];
            clearTimeout(item.timeout);
            item.done(msg.err, msg.data);
        }
        
        this._workerQueue.push(cluster.workers[msg.worker]);
        this._process();
    }
    
    _onTimeout (item) {
        delete this._items[item.id];
        
        if (item.retries === this._itemRetries) {
            item.done(new Error("[ghost-town] max pageTries"));
        } else {
            this.queue(item.data, true, item.done, item.retries + 1);
        }
    }
    
    _onExit (worker) {
        for (let id in this._items) {
            const item = this._items[id];
            
            if (item.worker === worker) {
                delete this._items[id];
                clearTimeout(item.timeout);
                this.queue(item.data, true, item.done, item.retries);
            }
        }
        
        if (this.isRunning) {
            cluster.fork().on("message", this._onMessage.bind(this));
        }
    }
    
    start () {
        if (this.isRunning) {
            return;
        }
        
        this.isRunning = true;
        
        for (let i = this._workerCount; i--;) {
            this._onExit();
        }
    }
    
    stop () {
        this.isRunning = false;
        
        for (let key in cluster.workers) {
            cluster.workers[key].kill();
        }
    }
    
    queue (data, asap, next, tries) {
        const item = {
            id: this._itemClicker++,
            timeout: -1,
            retries: tries || 0,
            data: data,
            done: next || asap,
        };
        
        this._itemQueue[next && asap ? "unshift" : "push"](item);
        this._process();
    }
    
    _process () {
        while (this._workerQueue.length && this._itemQueue.length) {
            const worker = this._workerQueue.shift();
            
            if (!worker || !worker.process.connected) {
                continue;
            }
            
            const item = this._itemQueue.shift();
            
            item.worker = worker;
            item.timeout = setTimeout(this._onTimeout.bind(this, item), this._itemTimeout);
            this._items[item.id] = item;
            
            worker.send({
                ghost: "town",
                id: item.id,
                data: item.data,
            });
        }
    }
}

class Worker extends events.EventEmitter {
    constructor (opts) {
        opts = is("object", opts, {});
        
        super();
        
        this.isMaster = false;
        
        this._workerDeath = is("number", opts.workerDeath, 25);
        this._workerShift = is("number", opts.workerShift, -1);
        
        this._pageCount = is("number", opts.pageCount, 1);
        this._pageClicker = 0;
        this._pages = {};
        
        const flagArr = [];
        const flagObj = is("object", opts.phantomFlags, {});
        
        for (let key in flagObj) {
            flagArr.push("--" + key + "=" + flagObj[key]);
        }
        
        phantom.create(flagArr, {
            phantomPath: opts.phantomBinary,
        }).then((proc) => {
            this.phantom = proc;
            
            for (let i = this._pageCount; i--;) {
                process.send({
                    ghost: "town",
                    worker: cluster.worker.id,
                });
            }
        });
        
        process.on("message", this._onMessage.bind(this));
        
        if (this._workerShift !== -1) {
            setTimeout(this._exit.bind(this), this._workerShift);
        }
    }
    
    _onMessage (msg) {
        if (is("object", msg, {}).ghost !== "town") {
            return;
        }
        
        this.phantom.createPage().then((page) => {
            this._pageClicker++;
            this._pages[msg.id] = page;
            this.emit("queue", page, msg.data, this._done.bind(this, msg.id));
        });
    }
    
    _done (id, err, data) {
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
            data: data,
        });
        
        if (this._pageClicker >= this._workerDeath) {
            this._exit();
        }
    }
    
    _exit () {
        this.phantom.process.on("exit", process.exit);
        this.phantom.exit();
    }
}

module.exports = (opts) => {
    return cluster.isMaster ? new Master(opts) : new Worker(opts);
};

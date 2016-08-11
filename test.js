"use strict";

const async = require("async");
const child = require("child_process");
const cluster = require("cluster");
const expect = require("chai").expect;
const ghost = require("./");

let townSend;

if (cluster.isMaster) {
    cluster.setupMaster({
        exec: __filename,
    });
    
    cluster.on("online", function (worker) {
        worker.send(townSend || null);
    });
    
    afterEach(function (next) {
        let live = 1;
        
        function step () {
            if (!--live) {
                child.exec("killall phantomjs", next.bind(null, null));
            }
        }
        
        cluster.removeAllListeners("exit");
        
        for (let key in cluster.workers) {
            live++;
            cluster.workers[key].on("exit", step).kill();
        }
        
        step();
    });
    
    describe("Master", function () {
        this.timeout(5000);
        
        describe("constructor", function () {
            it("should defer start()", function () {
                let town = ghost({deferStart: true});
                expect(town.isRunning).to.equal(false);
            });

            it("should support workerCount", function () {
                ghost({ workerCount: 8 });
                
                expect(Object.keys(cluster.workers)).to.have.length(8);
            });
            
            it("should support pageDeath", function (next) {
                townSend = {};
                let town = ghost({ pageDeath: 100 });
                
                async.waterfall([function (next) {
                    // Give Ghost Town a dummy task it can keep timing out on
                    // until phantom is warmed up and actually ready
                    town.queue(0, function () { next(); });
                }, function (next) {
                    // Prevent retries to get an immediate test result
                    town._itemRetries = 0;
                    town.queue(0, function (err) {
                        expect(err).to.be.null;
                        next();
                    });
                }, function (next) {
                    town.queue(100, function (err) {
                        expect(err).to.be.an.instanceof(Error);
                        next();
                    });
                }], next);
            });
            
            it("should support pageTries (-1)", function (next) {
                townSend = {};
                let town = ghost({ workerCount: 1, pageDeath: 0 });
                let keys = Object.keys(cluster.workers);
                let trys = 0;
                
                cluster.workers[keys[0]].on("message", function (msg) {
                    trys++;
                    
                    if (trys > 25) {
                        next();
                    }
                });
                
                town.queue(0, function () {
                    next(Error("shouldn't have completed"));
                });
            });

            it("should support pageTries (x)", function (next) {
                townSend = {};
                let town = ghost({ pageDeath: 0, pageTries: 42 });
                
                town.queue(0, function (err) {
                    expect(err).to.be.an.instanceof(Error);
                    
                    next();
                });
            });
        });
        
        describe("#start()", function () {
            it("should start Ghost Town", function () {
                let town = ghost();
                
                expect(town).to.respondTo("start");
                expect(town.isRunning).to.be.true;
            });
            
            it("should start all workers", function () {
                ghost({ workerCount: 5 });
                
                expect(Object.keys(cluster.workers)).to.have.length(5);
            });
            
            it("should restart Ghost Town and all workers", function () {
                let town = ghost({ workerCount: 5 });
                
                town.stop();
                town._workerCount = 11;
                town.start();
                
                expect(town.isRunning).to.be.true;
                expect(Object.keys(cluster.workers)).to.have.length(11);
            });
            
            it("should be idempotent", function () {
                let town = ghost({ workerCount: 5 });
                
                town.start();
                town.start();
                town.start();
                
                expect(Object.keys(cluster.workers)).to.have.length(5);
            });
        });
        
        describe("#stop()", function () {
            it("should stop Ghost Town", function () {
                let town = ghost();
                
                town.stop();
                
                expect(town).to.respondTo("stop");
                expect(town.isRunning).to.be.false;
            });
            
            it("should stop all workers", function () {
                let town = ghost();
                
                town.stop();
                
                expect(cluster.workers).to.be.empty;
            });
        });
        
        describe("#queue()", function () {
            it("should process items", function () {
                let town = ghost();
                
                expect(town).to.respondTo("queue");
            });
            
            it("should return results", function (next) {
                townSend = {};
                let town = ghost();
                
                town.queue(42, function (err, val) {
                    expect(err).to.be.null;
                    expect(val).to.equal(42);
                    
                    next();
                });
            });
            
            it("should support prepending", function () {
                let town = ghost();
                let curr = town._itemQueue;
                
                town.queue(0, function () {});
                town.queue(0, function () {});
                
                let orig = curr.slice();
                
                town.queue(0, town.queue);
                
                expect(curr).to.deep.equal([
                    orig[0],
                    orig[1],
                    curr[2]
                ]);
                
                town.queue(0, true, town.start);
                town.queue(0, false, town.stop);
                
                expect(curr).to.deep.equal([
                    curr[0],
                    orig[0],
                    orig[1],
                    curr[3],
                    curr[4]
                ]);
                
                expect(curr).to.have.deep.property("[0].done", town.start);
                expect(curr).to.have.deep.property("[3].done", town.queue);
                expect(curr).to.have.deep.property("[4].done", town.stop);
            });
        });
    });
    
    describe("Worker", function () {
        this.timeout(5000);
        
        describe("constructor", function () {
            // Pending release of https://github.com/amir20/phantomjs-node/pull/507
            it("should support phantomBinary");
            
            it("should support phantomFlags", function (next) {
                townSend = { _test: "pid", phantomFlags: { "disk-cache": "true" } };
                let town = ghost({ workerCount: 1 });
                
                town.queue(null, function (err, val) {
                    expect(err).to.be.null;
                    
                    child.exec("ps -p " + val + " -o command | sed 1d", function (err, out) {
                        expect(out).to.contain("--disk-cache=true");
                        
                        next();
                    });
                });
            });
            
            it("should support workerDeath", function (next) {
                townSend = { workerDeath: 10 };
                let town = ghost({ workerCount: 1 });
                let orig = Object.keys(cluster.workers);
                
                expect(orig).to.have.length(1);
                
                async.timesSeries(11, function (n, next) {
                    expect(cluster.workers).to.have.keys(orig);
                    town.queue(0, next);
                }, function () {
                    expect(cluster.workers).to.not.have.keys(orig);
                    
                    next();
                });
            });
            
            it("should support workerShift", function (next) {
                townSend = { workerShift: 10 };
                let town = ghost({ workerCount: 1 });
                let orig = Object.keys(cluster.workers);
                
                expect(orig).to.have.length(1);
                
                setTimeout(function () {
                    expect(cluster.workers).to.not.have.keys(orig);
                    
                    next();
                }, 2000);
            });
            
            it("should support pageCount", function (next) {
                townSend = { pageCount: 3 };
                let town = ghost({ workerCount: 1 });
                
                town.queue(0, function () { setImmediate(function () {
                    town.queue(0);
                    town.queue(0);
                    town.queue(0);
                    
                    expect(town._itemQueue).to.be.empty;
                    
                    town.queue(0);
                    town.queue(0);
                    
                    expect(town._itemQueue).to.have.length(2);
                    
                    next();
                }); });
            });
        });
        
        describe("!queue", function () {
            it("should pass arguments", function (next) {
                townSend = { _test: "passArgs" };
                let town = ghost();
                
                town.queue(42, next);
            });
            
            it("should have an idempotent callback", function (next) {
                townSend = { _test: "passOnce" };
                let town = ghost({ workerCount: 3 });
                
                town.queue(0, function (err, val) {
                    setTimeout(function () {
                        expect(town._workerQueue).to.have.length(3);
                        
                        next();
                    }, 500);
                });
            });
        });
    });
    
    describe("Ghost Town", function () {
        this.timeout(25000);
        
        it("should handle heavy loads", function (next) {
            townSend = {};
            let town = ghost();
            
            async.times(500, function (n, next) {
                town.queue(n / 100, function (err, val) {
                    if (err) {
                        next(new Error("shouldn't have errored: " + err));
                    } else if (val !== n / 100) {
                        next(new Error("returned the wrong data"));
                    } else {
                        next();
                    }
                });
            }, next);
        });
        
        it("should handle many timeouts", function (next) {
            townSend = {};
            let town = ghost({ pageDeath: 100, pageTries: 0 });
            
            async.times(100, function (n, next) {
                town.queue(n % 1 ? (n / 100) : 101, function (err, val) {
                    if (n % 1) {
                        if (err) {
                            next(new Error("shouldn't have timed out"));
                        } else if (val !== n / 100) {
                            next(new Error("returned the wrong data"));
                        } else {
                            next();
                        }
                    } else if (!err) {
                        next(new Error("should have timed out"));
                    } else {
                        next();
                    }
                });
            }, next);
        });
    });
} else {
    const townTest = {
        pid: function (town, page, data, next) {
            next(null, town.phantom.process.pid);
        },
        passArgs: function (town, page, data, next) {
            expect(page).to.be.an("object");
            expect(page.renderBase64).to.be.a("function");
            
            expect(data).to.equal(42);
            
            expect(next).to.be.a("function");
            
            next();
        },
        passOnce: function (town, page, data, next) {
            next();
            next();
            next();
        },
    };
    
    process.once("message", function (opts) {
        const town = ghost(opts).on("queue", function (page, data, next) {
            if (opts._test) {
                try {
                    townTest[opts._test](town, page, data, next);
                } catch (err) {
                    next(err);
                }
            } else {
                setTimeout(next, data, null, data);
            }
        });
    });
}

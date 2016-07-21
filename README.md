[![license](https://img.shields.io/npm/l/ghost-town.svg?style=flat)](http://opensource.org/licenses/MIT) [![version](https://img.shields.io/npm/v/ghost-town.svg?style=flat)](https://www.npmjs.com/package/ghost-town) [![dependencies](https://img.shields.io/david/buzzvil/ghost-town.svg?style=flat)](https://david-dm.org/buzzvil/ghost-town)  
Simple queued & clustered PhantomJS processing. https://www.npmjs.com/package/ghost-town

*Now with 100% creepier dependencies! Check out Ghost Town 3's breaking changes in [CHANGELOG.md](CHANGELOG.md).*

---

Need highly scalable PhantomJS processing? Ghost Town makes it frighteningly easy! For example, on-demand page rendering, dispatched through Thrift:

    var town = require("ghost-town")();
    
    if (town.isMaster) {
        thrift.createServer(Renderer, {
            render: function (html, width, height, next) {
                town.queue({
                    html: html,
                    width: width,
                    height: height
                }, function (err, data) {
                    next(err, !err && new Buffer(data, "base64"));
                });
            }
        }).listen(1337);
    } else {
        town.on("queue", function (page, data, next) {
            // sequential page setup
            // page.property("viewportSize", ...)
            // page.property("customHeaders", ...)
            // page.property("onLoadFinished", ...)
            // page.property("content", ...)
            
            page.renderBase64("jpeg").then(function (res) {
                next(null, res);
            }).catch(next);
        });
    }

Ghost Town uses Node's Cluster API, so the master and worker share their code. On the master side, queue items and handle their results. On the worker side, process items and return their results.

Requires Node 4+ and PhantomJS 2.1+.

---

`town(options)`

* `phantomBinary`: String path to the PhantomJS executable. Default: Automatic via `$PATH`.
* `phantomFlags`: Object of strings to use for the PhantomJS options. Default: `{}`.
* `workerCount`: Number of workers to maintain. One or two per CPU is recommended. Default: `4`.
* `workerDeath`: Number of items to process before restarting a worker. Default: `25`.
* `workerShift`: Number of milliseconds to wait before restarting a worker. Default: `-1` (forever).
* `pageCount`: Number of pages to process at a time. If your processing is mostly asynchronous (vs. e.g. render blocked), increasing this is recommended. Default: `1`.
* `pageDeath`: Number of milliseconds to wait before before requeuing an item. If your processing is time-sensitive, decreasing this is recommended. Default: `30000`.
* `pageTries`: Number of times to retry items that have timed out. If your processing could fail forever, configuring this is recommended. Default: `-1` (unlimited).

Starts Ghost Town and returns a `Master` or a `Worker` instance exposing the following.

* `Master#isRunning` is set by `Master#start()` and `Master#stop()`.
* `Master#isMaster` and `Worker#isMaster` can be used to separate master- and worker-specific code.
* `Worker#phantom` is the PhantomJS wrapper object provided by [phantom](https://www.npmjs.com/package/phantom).

`Master#start()` and `Master#stop()`  
Starts or stops processing. These spawn or kill workers and PhantomJS processes, so they're useful for managing resource usage or gracefully shutting down Node.

`Master#queue(data, [asap], next)`  
Queue an item for processing by a worker. `data` is passed to `Worker!queue()`, and `next(err, data)` is called when complete. Optionally pass `true` to `asap` to prepend to the queue.

`Worker!queue(page, data, next)`  
Fired when a worker receives an item to process. `page` is the PhantomJS page, `data` is what was passed to `Master#queue()`, and `next(err, data)` passes it back.

---

© 2016 [Buzzvil](http://www.buzzvil.com), shared under the [MIT license](http://www.opensource.org/licenses/MIT).

[![npm](http://img.shields.io/npm/v/ghost-town.svg)](https://www.npmjs.org/package/ghost-town) [![dependencies](https://david-dm.org/buzzvil/ghost-town.svg?theme=shields.io)](https://david-dm.org/buzzvil/ghost-town)  
Simple queued & clustered PhantomJS processing. https://www.npmjs.org/package/ghost-town

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
                    next(err, new Buffer(data, "base64"));
                });
            }
        }).listen(1337);
    } else {
        town.on("queue", function (page, data, next) {
            ...
            
            page.renderBase64("jpeg", function (data) {
                next(null, data);
            });
        });
    }

Ghost Town uses Node's Cluster API, so the master and worker share their code. On the master side, queue items and handle their results. On the worker side, process items and return their results.

---

`town(options)`

* `phantomBinary`: String to use for finding the PhantomJS binary. Default: Searches the PATH.
* `phantomFlags`: Array of strings to use for the PhantomJS options. Default: `[]`.
* `phantomPort`: Number to use for the PhantomJS port range. Default: `12300`.
* `workerCount`: Number of workers to maintain. Default: `os.cpus().length`.
* `workerDeath`: Number of items to process before restarting a worker. Default: `20`.
* `pageCount`: Number of pages to process at a time. If your processing is mainly asynchronous (vs. e.g. mainly rendering), increasing this is recommended. Default: `1`.
* `pageDeath`: Number of milliseconds to wait before before requeuing an item. If your processing is time-sensitive, decreasing this is recommended. Default: `120000`.

Returns either a `Master` or `Worker` instance, depending on `town.isMaster`.

`Master#start()` and `Master#stop()`  
Starts or stops processing. These spawn or kill workers and PhantomJS processes, so they're useful for managing resource usage or gracefully shutting down Node.

`Master#queue(data, next)`  
Queue an item for processing by a worker. `data` will be passed to `Worker!queue()`, and `next(err, data)` is called when complete.

`Worker!queue(page, data, next)`  
Fired when a worker receives an item to process. `page` is the PhantomJS page, `data` is what was passed to `Master#queue()`, and `next(err, data)` passes it back.

---

© 2014 [Buzzvil](http://www.buzzvil.com), shared under the [MIT License](http://www.opensource.org/licenses/MIT).
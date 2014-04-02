Simple queued PhantomJS clustering. https://npmjs.org/package/ghost-town

---

`town(options)`

* `phantomBinary`: String to use for finding the PhantomJS binary. Default: Searches the PATH.
* `phantomFlags`: Array of strings to use for the PhantomJS options. Default: Empty.
* `phantomPort`: Number to use for the PhantomJS port range. Default: `12300`.
* `workerCount`: Number of workers to maintain. Default: CPU count.
* `workerDeath`: Number of items to process before restarting a worker. Default: `20`.
* `pageCount`: Number of pages to maintain. Default: `1`.
* `pageDeath`: Number of milliseconds to wait before before requeuing an item. Default: `120000`.

Returns either a `Master` or `Worker` instance, depending on `town.isMaster`.

`Master#queue(data, next)`  
Queue an item for processing by a worker. `data` will be passed to `Worker!queue()`, and `next(err, data)` is called when complete.

`Worker!queue(page, data, next)`  
Fired when a worker receives an item to process. `page` is the PhantomJS page, `data` is what was passed to `Master#queue()`, and `next(err, data)` passes it back.

---

© 2014 [Buzzvil](http://www.buzzvil.com), shared under the [MIT License](http://www.opensource.org/licenses/MIT).
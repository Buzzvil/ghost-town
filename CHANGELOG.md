2.1.0 / 2015-02-27
==================

* Add the `workerShift` option. Use it if PhantomJS is occasionally never returning.

2.0.0 / 2015-02-05
==================

Ghost Town 2 is a major refactor release made up of several small but breaking changes. Please carefully review each before upgrading!

* Add tests!
* Add an optional `asap` argument to `Master#queue()`.
* Update `phantom` to `~0.7.2`. Now works with PhantomJS 2!
* Remove `phantom`'s default PhantomJS stdout and stderr logging. Listen to the `.stdout` and `.stderr` streams on the `Worker#phantom` object instead.
* Change the Ghost Town worker management algorithm so that it trusts workers less. May fix race conditions.
* Change the `phantomFlags` option to accept an object instead of an array. Separate the key and value so that `"--disk-cache=true"` becomes `"disk-cache": "true"`.
* Change some option defaults. `workerCount`: `os.cpus().length` to `4`. `pageDeath`: `120000` to `30000`. `workerDeath`: `20` to `25`.
* Rename `Master#running` to `Master#isRunning`.
* Rename all private properties to be private.
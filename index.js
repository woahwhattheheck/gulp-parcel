const parcelBundler = require('parcel-bundler');
const fs = require('fs');
const path = require('path');
const through = require('through2');
const PluginError = require('plugin-error');

function removeDirectory(dir)
{
    try {
        if(fs.statSync(dir).isDirectory()) {
           var files = fs.readdirSync(dir);
            for (var file in files) {
                removeDirectory(dir + '/' + files[file])
            }
            fs.rmdirSync(dir);
        } else {
            fs.unlinkSync(dir);
        }
    } catch (err) {
        if(err.code === 'ENOENT') {
            return false;
        }
    }
}

module.exports = function GulpParcel(...options)
{
    const PLUGIN_NAME = 'gulp-parcel';
    const pid = process.pid.toString();

    let g_options = {};
    if(options.length > 0) {
        if(options.length > 1) {
            g_options = options[1];
        }
        options = options[0];
    }

    options.watch = (typeof(options.watch) == "undefined") ? false : options.watch;
    options.production = (typeof(options.production) == "undefined") ? !options.watch : options.production;
    const isTmp = options.outDir ? false : true;
    options.outDir = options.outDir ? options.outDir : ('.tmp-gulp-compile-' + pid);

    const source = g_options.source ? g_options.source : '';

    return through.obj(function (file, encoding, cb) {
        if (!!file.contents) {
            return cb(new PluginError(PLUGIN_NAME, "File has already been processed"));
        }

        // slashes on unix os
        // backslashes on windows
		let slashes = '/';

		if( file.path.lastIndexOf(slashes) === -1){
			slashes = '\\';
        }

        let options_c = {}, outDir;
        Object.assign(options_c, options);
        outDir = file.path.substr(file.path.lastIndexOf(source));
        let position = outDir.lastIndexOf(slashes) - 1;
        position = outDir.lastIndexOf(slashes, position);
        if(position < 0) {
            outDir = options.outDir;
        } else {
            outDir = outDir.substr(position + 1);
            outDir = outDir.substr(0, outDir.lastIndexOf(slashes));
            outDir = options.outDir + slashes + outDir;
        }
        options_c.outDir = outDir;

        const onSigint = () => {
            if(isTmp) {
                removeDirectory(options.outDir);
            }
            process.exit();
        };
        process.on('SIGINT', onSigint);

        let finished = false;
        const finish = err => {
            if(finished) {
                return;
            }
            finished = true;
            if(!options.watch) {
                process.removeListener('SIGINT', onSigint);
            }
            if(isTmp && (err || options.production)) {
                removeDirectory(options.outDir);
            }
            if(err) {
                cb(new PluginError(PLUGIN_NAME, err));
            } else {
                cb(null, file);
            }
        };

        let parcel;
        Promise.resolve().then(() => {
            parcel = new parcelBundler(file.path, options_c);
            return parcel.bundle();
        }).then(bundle => {
            if(parcel.error || parcel.errored) {
                throw parcel.error || new Error("Build FAIL:" + file.path);
            }
            if(!bundle || typeof bundle.name !== 'string' || !bundle.name) {
                throw new Error("Parcel did not return an output file for " + file.path);
            }

            // Parcel determines the final extension and honors outFile itself.
            // Read that output instead of guessing a path from the input name.
            fs.readFile(bundle.name, (err, data) => {
                if(err) {
                    return finish(err);
                }
                fs.stat(bundle.name, (err, stat) => {
                    if(err) {
                        return finish(err);
                    }
                    try {
                        file.path = path.join(path.dirname(file.path), path.basename(bundle.name));
                        file.contents = data;
                        file.stat = stat;
                    } catch(err) {
                        return finish(err);
                    }
                    finish();
                });
            });
        }).catch(finish);
    });
}

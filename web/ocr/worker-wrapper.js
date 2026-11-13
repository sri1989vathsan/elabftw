/*
 * Fork-only. The web server of the image sends only the files of some types (.js, .css, images): the model of the language is
 * kept as eng.traineddata.gz.js (the same bytes) and the request for eng.traineddata.gz is sent there. Then the worker of tesseract.js runs.
 */
(function () {
  'use strict';
  const original = self.fetch;
  self.fetch = function (resource, options) {
    if (typeof resource === 'string' && /\.traineddata(\.gz)?$/.test(resource)) {
      resource = resource.replace(/\.traineddata(\.gz)?$/, '.traineddata.gz.js');
    }
    return original.call(self, resource, options);
  };
})();
importScripts('worker.min.js');

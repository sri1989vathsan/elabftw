Fork-only. OCR in the browser for the order window (reading a pasted screenshot of a vendor page), so it works where the server has no internet.
Files (not changed): tesseract.min.js and worker.min.js (tesseract.js 7.0.0, Apache-2.0), tesseract-core-simd-lstm.wasm.js (tesseract.js-core, the OCR engine
with its WebAssembly inside, Apache-2.0), eng.traineddata.gz.js (the same bytes as eng.traineddata.gz: the web server sends only some file types, see worker-wrapper.js; English model "4.0.0_best_int" of @tesseract.js-data/eng, Apache-2.0).

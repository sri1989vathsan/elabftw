#!/bin/bash
# <ol start="4"> keeps its number in the PDF export (mPDF), run from the repo root with the web container up. Expect "4." and "5." in the text.
set -e
out=$(mktemp -d)
docker compose exec -T web php -r 'require "/elabftw/vendor/autoload.php"; $m=new \Mpdf\Mpdf(["tempDir"=>"/run/elabftw/tmp"]); $m->WriteHTML("<p>t</p><ol start=\"4\"><li>four</li><li>five</li></ol>"); echo $m->Output("","S");' > "$out/ol.pdf"
text=$(swift tests/manual/pdf-text.swift "$out/ol.pdf")
echo "$text" | grep -q '^4\.' && echo "$text" | grep -q '^5\.' && echo "PASS: PDF numbers the list from 4" || { echo "FAIL"; echo "$text"; exit 1; }

<?php

namespace Elabftw\Services;

use DOMDocument;
use DOMXPath;

final class TocBuilder
{
    public static function build(string $html): array
    {
        if (trim($html) === '') {
            return ['html' => $html, 'toc' => []];
        }

        libxml_use_internal_errors(true);

        $dom = new DOMDocument();
        $dom->loadHTML(
            '<?xml encoding="utf-8" ?><div id="toc-root">' . $html . '</div>',
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
        );

        $xpath = new DOMXPath($dom);
        $nodes = $xpath->query('//h1 | //h2 | //h3');

        $seen = [];
        $toc = [];

        foreach ($nodes as $node) {
            $title = trim($node->textContent ?? '');
            if ($title === '') {
                continue;
            }

            $baseId = self::slugify($title);
            $id = $baseId;
            $i = 2;
            while (isset($seen[$id])) {
                $id = $baseId . '-' . $i;
                $i++;
            }
            $seen[$id] = true;

            $node->setAttribute('id', $id);
            $level = (int) substr($node->nodeName, 1);

            $toc[] = [
                'level' => $level,
                'id' => $id,
                'title' => $title,
            ];
        }

        $root = $dom->getElementById('toc-root');
        $patchedHtml = '';
        if ($root !== null) {
            foreach ($root->childNodes as $child) {
                $patchedHtml .= $dom->saveHTML($child);
            }
        }

        return ['html' => $patchedHtml, 'toc' => $toc];
    }

    private static function slugify(string $text): string
    {
        $text = mb_strtolower($text);
        $text = preg_replace('/[^\p{L}\p{N}]+/u', '-', $text) ?? '';
        $text = trim($text, '-');
        return $text !== '' ? $text : 'section';
    }
}

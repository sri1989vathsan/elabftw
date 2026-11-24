<?php

/**
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

use function preg_match;
use function preg_replace;
use function strlen;
use function strtolower;
use function substr;

/**
 * Mixed styles inside one line of a label: **bold**, *italic*, [big]bigger[/big] and [small]smaller[/small] (1.4 and 0.7 times the size of the
 * line). The same rules as label-markup.js (the dialog); tests/manual/label-markup-cases.json holds the cases both must agree on.
 *
 * parse() gives ['pieces' => [['text', 'bold', 'italic', 'scale']], 'marked' => bool, 'plain' => string]. Markup that does not add up (a marker
 * opened and not closed, closed twice, big inside small, nothing between the markers) is not markup: the line is plain text, as typed.
 * A backslash before * or [ writes that character (values of {fields} are escaped with escape()).
 */
final class LabelMarkup
{
    public const SCALES = array('big' => 1.4, 'small' => 0.7);

    public static function escape(string $value): string
    {
        return (string) preg_replace('/([*\[])/', '\\\\$1', $value);
    }

    /** @return array{pieces: list<array{text: string, bold: bool, italic: bool, scale: float}>, marked: bool, plain: string} */
    private static function plain(string $text): array
    {
        $plain = (string) preg_replace('/\\\\([*\[])/', '$1', $text);
        return array('pieces' => array(array('text' => $plain, 'bold' => false, 'italic' => false, 'scale' => 1.0)), 'marked' => false, 'plain' => $plain);
    }

    /** @return array{pieces: list<array{text: string, bold: bool, italic: bool, scale: float}>, marked: bool, plain: string} */
    public static function parse(string $text): array
    {
        if (!str_contains($text, '*') && !str_contains($text, '[')) {
            return array('pieces' => array(array('text' => $text, 'bold' => false, 'italic' => false, 'scale' => 1.0)), 'marked' => false, 'plain' => $text);
        }
        $bold = false;
        $italic = false;
        $size = '';
        $buffer = '';
        $pieces = array();
        $flush = static function () use (&$buffer, &$pieces, &$bold, &$italic, &$size): void {
            if ($buffer === '') {
                return;
            }
            $scale = $size === '' ? 1.0 : self::SCALES[$size];
            $last = count($pieces) - 1;
            if ($last >= 0 && $pieces[$last]['bold'] === $bold && $pieces[$last]['italic'] === $italic && $pieces[$last]['scale'] === $scale) {
                $pieces[$last]['text'] .= $buffer;
            } else {
                $pieces[] = array('text' => $buffer, 'bold' => $bold, 'italic' => $italic, 'scale' => $scale);
            }
            $buffer = '';
        };
        $length = strlen($text);
        $i = 0;
        while ($i < $length) {
            $c = $text[$i];
            $next = $i + 1 < $length ? $text[$i + 1] : '';
            if ($c === '\\' && ($next === '*' || $next === '[')) {
                $buffer .= $next;
                $i += 2;
                continue;
            }
            if ($c === '*') {
                $flush();
                if ($next === '*') {
                    $bold = !$bold;
                    $i += 2;
                } else {
                    $italic = !$italic;
                    ++$i;
                }
                continue;
            }
            if ($c === '[' && preg_match('/^\[(\/?)(big|small)\]/i', substr($text, $i, 9), $tag) === 1) {
                $name = strtolower($tag[2]);
                $flush();
                if ($tag[1] === '') {
                    if ($size !== '') {
                        return self::plain($text);
                    }
                    $size = $name;
                } else {
                    if ($size !== $name) {
                        return self::plain($text);
                    }
                    $size = '';
                }
                $i += strlen($tag[0]);
                continue;
            }
            $buffer .= $c;
            ++$i;
        }
        $flush();
        if ($bold || $italic || $size !== '' || $pieces === array()) {
            return self::plain($text);
        }
        $marked = false;
        $plain = '';
        foreach ($pieces as $piece) {
            $marked = $marked || $piece['bold'] || $piece['italic'] || $piece['scale'] !== 1.0;
            $plain .= $piece['text'];
        }
        return array('pieces' => $pieces, 'marked' => $marked, 'plain' => $plain);
    }
}

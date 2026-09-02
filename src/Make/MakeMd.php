<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Make;

use Elabftw\Enums\BodyContentType;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Interfaces\StringMakerInterface;
use Elabftw\Models\AbstractEntity;
use Elabftw\Services\Filter;
use Override;

use function mb_strlen;
use function sprintf;

/**
 * Export a single entity's body as a raw .md file. Only available for
 * entities whose body is actually stored as markdown -- the body of an
 * html (rich text) entity is not converted, since a rich text body may use
 * formatting markdown cannot represent, and this is meant as a plain
 * passthrough of what's already in the markdown editor rather than another
 * html-to-markdown conversion path.
 */
final class MakeMd extends AbstractMake implements StringMakerInterface
{
    protected string $contentType = 'text/markdown';

    public function __construct(private AbstractEntity $entity)
    {
        parent::__construct();
    }

    #[Override]
    public function getFileName(): string
    {
        return sprintf('%s.md', Filter::forFilesystem($this->entity->entityData['title']));
    }

    #[Override]
    public function getFileContent(): string
    {
        if ((int) $this->entity->entityData['content_type'] !== BodyContentType::Markdown->value) {
            throw new ImproperActionException('This entry is not using the markdown editor.');
        }
        $body = $this->entity->entityData['body'] ?? '';
        $this->contentSize = mb_strlen($body);
        return $body;
    }
}

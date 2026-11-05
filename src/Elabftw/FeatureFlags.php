<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

/**
 * Readiness gates for fork-owned features that are intentionally dormant.
 *
 * Keep these separate from instance configuration: administrators should not
 * be able to activate an integration until its implementation is ready for
 * use. Flip a constant to true when the corresponding feature is released.
 */
final class FeatureFlags
{
    public const bool ANIMAL_STUDIES = false;

    public const bool HTML_TOOLS = false;
}

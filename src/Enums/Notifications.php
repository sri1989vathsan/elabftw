<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2023 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Enums;

/**
 * Numbering ranges (keeps the notifications.category column mergeable with upstream):
 * 10-99 and 100 are upstream's (a case upstream adds there, e.g. 15, 16, 100, must
 * not be reused by the fork); fork-only categories live in 1000-1999.
 */
enum Notifications: int
{
    case CommentCreated = 10;
    case UserCreated = 11;
    case UserNeedValidation = 12;
    case StepDeadline = 13;
    case EventDeleted = 14;
    case TodoDeadline = 1015;
    case MentionedInTask = 1016;
    case MentionedInOrder = 1017;
    case TaskAssigned = 1018;
    case OrderStatusChanged = 1019;
    case SelfNeedValidation = 20;
    case SelfIsValidated = 30;
    case MathjaxFailed = 40;
    case PdfAppendmentFailed = 50;
    case PdfGenericError = 60;
    case NewVersionInstalled = 70;
    case OnboardingEmail = 80;
    case ActionRequested = 90;
    case OrderReminder = 1100;
    case OrderChanged = 1101;
    case MentionedInFeedback = 1102;
    case AnnouncementPublished = 1103;
    case AccessGranted = 1104;
    case MentionedInEntry = 1105;
    case StepFinished = 1106;
    case StepAssigned = 1107;
}

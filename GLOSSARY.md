# Glossary

## Accepted Click

A click whose target site processes the action and changes state. For the X caret menu, the menu closing or the tweet changing is stronger evidence than a JavaScript event firing.

## Isolated World

The Chrome extension content-script JavaScript environment. It can read and edit the DOM, but its synthetic events may not behave exactly like page-owned user events.

## Main World

The web page's own JavaScript environment. Code running here is closer to a userscript and can trigger page event handlers that may ignore isolated-world synthetic events.

## Saved summary

The popup's entire collections grant (ADR-0013): a no-argument, account-free read carrying exactly two numbers — the live Folder count and the Saved-Post total, deduped by X status id regardless of how many Folders hold a post or which X accounts bookmarked it. It names no Destination configuration and carries no owner, token, endpoint, post text, permalink, or author; any surface receiving a superset of those two keys rejects the response whole rather than rendering the valid part.

## Side Effect

The observable result produced by the target site after an action, such as X replacing a tweet with a feedback panel after "Not interested".


/**
 * Folder ids are minted here and nowhere else: no caller-supplied value can enter
 * one, and a Lasso-minted id carries no account segment. The format is declared
 * so a test can pin it by pattern.
 */
const ALPHABET = "0123456789abcdefghijklmnopqrstuv";
const BODY_LENGTH = 20;

/** `fld_` + 20 base-32 characters. */
export const FOLDER_ID_RE = /^fld_[0-9a-v]{20}$/;

export function mintFolderId(): string {
  let body = "";
  for (let i = 0; i < BODY_LENGTH; i++) {
    body += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `fld_${body}`;
}

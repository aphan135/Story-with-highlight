/**
 * The book the child reads aloud. Public domain (The Three Little Pigs),
 * retold in short sentences for readers aged 6 to 9.
 *
 * `ask` lists the dialogue scenes (prompts.ts SCENES) to run once the page has
 * been read. Scenes run in order; the story moves on when the last one
 * advances. Avoid stand-alone dashes and hyphenated words — every word on the
 * page has to be something Ink can hear.
 */

import type { State } from "./prompts";

export type Page = {
  text: string;
  /** What the child sees, one entry per highlighted word. */
  words: string[];
  ask?: State["scene"][];
};

const page = (text: string, ask?: State["scene"][]): Page => ({
  text,
  words: text.split(/\s+/).filter(Boolean),
  ask,
});

export const STORY: Page[] = [
  page(
    "Once upon a time there were three little pigs. One day they left home to build houses of their own.",
    [1]
  ),
  page(
    "The first little pig built his house of straw. The second little pig built his house of sticks. The third little pig had not started yet.",
    // Pip asks what to build with, then Owl asks why.
    [2, 3]
  ),
  page(
    'Then along came a big bad wolf. He knocked on the door of the straw house. "Little pig, little pig, let me come in!"'
  ),
  page(
    '"Not by the hair on my chin!" said the pig. So the wolf huffed and he puffed and he blew the house in.'
  ),
  page(
    "Next the wolf blew down the house of sticks. The two little pigs ran as fast as they could to their brother.",
    [4]
  ),
  page(
    "The wolf huffed and he puffed, but this house did not fall down. The three little pigs were safe at last.",
    [5]
  ),
];

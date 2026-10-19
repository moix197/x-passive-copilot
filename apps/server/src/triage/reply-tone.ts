/** Tone rules shared by the triage rough-draft prompt and the reply polish prompt: a peer's take, never a pitch. */
export function replyToneRules(product: string): string {
  return `Replies to other people's posts sound like a knowledgeable person in Robinhood Chain, the LONG
ecosystem, crypto, trading or building, answering what THAT post is actually about.
DO: add a specific insight, a take, a sharp question or a short first-hand experience on the post's topic.
DON'T: pitch, plug or mention ${product}, "our platform", "our tool", "we built something for this", or
link to it. Only exception: the post itself asks about ${product}, or explicitly asks for tools or
recommendations where it is directly relevant; then one low-key mention at most, no call to action.
Good (tone example only, never reuse its facts): "Most of that volume is the same few wallets cycling. Drop round trips under an hour and the chart tells a very different story."
Bad (a pitch): "We built ${product} to track exactly this, check it out."`;
}

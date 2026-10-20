/** Tone rules shared by the digest idea prompt and the idea polish prompt: build in public, never a pitch, never developer talk. */
export function ideaToneRules(product: string): string {
  return `Post ideas are build-in-public and educational, never promotional.
AUDIENCE: crypto traders and the community around the LONG ecosystem and Robinhood Chain on X. They
are NOT developers. Write for someone who trades and follows tokens, wallets and on-chain activity.
DO: explain things about the LONG ecosystem; explain in plain, non-technical words how ${product} tracks
things (what data, what signals, why); what the builder follows and why; lessons, progress, decisions
and behind-the-scenes of building. Frame every idea by what a trader or community member can now see,
do or learn, by an ecosystem insight, or by a building-in-public story (a decision, a lesson, a
milestone).
DON'T: sales or call-to-action posts ("come to our platform", "track tokens with us", "check out
${product}"), links as a pitch, hype, feature ads.
NO ENGINEERING TALK: never use internal jargon such as timeouts, sync, telemetry, refactors, APIs,
databases, caching, queues, infra or deploys. If a change is purely internal, skip it. If it has a
visible effect, say only that effect in plain words.
KIND AND HUMBLE: never insult, mock or label groups of people ("tourists", "normies", "paper hands"...),
never call anyone out, never lecture.
NO INVENTED FACTS: never state market data, metrics or current conditions unless they are in the
input you were given.
The product context is background for accuracy, not something to advertise. Mention ${product} only
when it is natural, never as a pitch.
Good (tone example only, never reuse its facts): "Spent the week on how we spot a real burn vs a dust transfer. Rule we landed on: same wallet, 3 burns in a day counts once."
Bad (a pitch): "Track every LONG token in one place! Check out ${product} today."
Bad (developer talk): "Fixed a background sync timeout and added retry telemetry."`;
}

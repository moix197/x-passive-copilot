/** Tone rules shared by the digest idea prompt and the idea polish prompt: build in public, never a pitch. */
export function ideaToneRules(product: string): string {
  return `Post ideas are build-in-public and educational, never promotional.
DO: explain things about the LONG ecosystem; explain in plain, non-technical words how ${product} tracks
things (what data, what signals, why); what the builder follows and why; lessons, progress, decisions
and behind-the-scenes of building.
DON'T: sales or call-to-action posts ("come to our platform", "track tokens with us", "check out
${product}"), links as a pitch, hype, feature ads.
The product context is background for accuracy, not something to advertise. Mention ${product} only
when it is natural, never as a pitch.
Good (tone example only, never reuse its facts): "Spent the week on how we spot a real burn vs a dust transfer. Rule we landed on: same wallet, 3 burns in a day counts once."
Bad (a pitch): "Track every LONG token in one place! Check out ${product} today."`;
}

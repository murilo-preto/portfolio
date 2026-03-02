import Section from "./Section";

export default function Summary() {
  return (
    <Section title="About Me">
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold">Murilo Preto</h2>
          <p className="text-sm text-muted-foreground">Born in 2003, Brazil</p>
        </div>
        <p className="text-sm leading-relaxed">
          Information Engineering student at UFABC with hands-on experience in
          AI/ML deployment at Qualcomm and award-winning academic research in
          computer vision and embedded systems. Strong background in deploying
          generative and computer vision models across proprietary and open-source
          inference engines on desktop and embedded Linux platforms.
        </p>
      </div>
    </Section>
  );
}

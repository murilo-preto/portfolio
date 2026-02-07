import Section from "./Section";

export default function Skills() {
  return (
    <Section title="Technical Skills">
      <div className="space-y-4 text-sm">
        <div>
          <h3 className="font-medium">AI / ML Deployment</h3>
          <ul className="list-disc list-inside">
            <li>QNN, SNPE, QAIC, ONNX, TFLite</li>
            <li>vLLM, Llama.cpp, Transformers, HuggingFace</li>
            <li>YOLO, CNNs, Autoencoders, RAG Systems</li>
          </ul>
        </div>

        <div>
          <h3 className="font-medium">Programming</h3>
          <p>Python, C, C++, Rust, Java, HTML, CSS, JavaScript</p>
        </div>

        <div>
          <h3 className="font-medium">Systems</h3>
          <p>Linux, Windows, Docker, Git, PostgreSQL, MySQL</p>
        </div>
      </div>
    </Section>
  );
}

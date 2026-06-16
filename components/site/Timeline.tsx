import { timelineSteps } from "@/lib/content";

export function Timeline() {
  return (
    <section className="bg-mk-paper py-section" data-screen-label="06 Timeline" id="timeline">
      <div className="mx-auto max-w-wrap px-gutter">
        <span className="section-num">
          <span className="bar" />
          06 — The Journey Ahead
        </span>
        <h2 className="section-heading max-w-4xl">
          From planning to <em>public activation.</em>
        </h2>
        <div className="timeline-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Phase</th>
                <th scope="col">Timeline</th>
              </tr>
            </thead>
            <tbody>
              {timelineSteps.map((step) => (
                <tr key={step.phase}>
                  <th scope="row">{step.phase}</th>
                  <td>{step.timeline}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

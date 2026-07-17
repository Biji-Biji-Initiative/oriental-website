import type { Metadata } from "next";
import { AnalyticsConsentSettings } from "@/components/site/GoogleAnalytics";
import { siteMeta } from "@/lib/content";

export const metadata: Metadata = {
  title: "Privacy notice · Oriental Building",
  description: "How the Oriental Building partner-intake site handles enquiries, voice interactions, and analytics.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="bg-mk-paper text-mk-off-black" id="main-content">
      <article className="mx-auto max-w-4xl px-gutter py-section">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mk-anchor-blue">
          Privacy notice · Notis privasi
        </p>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">Your information stays purposeful.</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-mk-off-black/70">
          This notice explains how the Mereka and Biji-biji Initiative teams operating the Oriental Building partner
          intake process handle information submitted through this site. It applies to written enquiries, optional voice
          interactions, operational telemetry, and optional public-site analytics.
        </p>

        <NoticeSection title="What we collect and why">
          <ul>
            <li>Contact and enquiry details you choose to provide, so the relevant partnership team can respond.</li>
            <li>
              Voice transcripts and technical session events when you choose voice, so the handoff works and quality can
              be reviewed. Customer audio is not stored by this website.
            </li>
            <li>Security and delivery events needed to prevent abuse, route the enquiry, and diagnose failures.</li>
            <li>
              Bounded interaction categories—where the intake opened, whether voice or the Send button submitted it, and
              whether each field was completed by voice, typing, prefill, or a mix. These metrics do not contain the
              field values.
            </li>
            <li>
              Public page-use events through Google Analytics only after you select “Allow analytics”. Query strings and
              admin routes are excluded.
            </li>
          </ul>
        </NoticeSection>

        <NoticeSection title="Your choices">
          <p>
            Email is required if you want a follow-up. Name, organisation, phone, website, message, and voice are
            optional. You can type instead of speaking. Analytics is optional and stays off until you allow it.
          </p>
          <AnalyticsConsentSettings />
        </NoticeSection>

        <NoticeSection title="Who may process the information">
          <p>
            Access is limited to the Mereka/Biji-biji operations team and the partner team assigned to your enquiry.
            Service providers may process only what is needed to deliver the service: Convex for application data,
            OpenAI for optional live voice transcription and responses, AWS/email and Slack/ClickUp for internal
            delivery, Sentry for error diagnostics, and Google only for analytics you allow. Some providers may process
            data outside Malaysia under their service safeguards.
          </p>
        </NoticeSection>

        <NoticeSection title="Retention, security, and your rights">
          <p>
            We use access controls, signed review credentials, rate limits, and restricted operator tools. We retain
            enquiry and operational records only for follow-up, service quality, security, and applicable legal needs,
            then delete or anonymise them when they are no longer needed. You may ask to access, correct, limit, or
            delete your personal data, or withdraw an optional choice.
          </p>
          <p>
            Contact <a href={`mailto:${siteMeta.email}`}>{siteMeta.email}</a> with “Oriental privacy request” in the
            subject.
          </p>
        </NoticeSection>

        <hr className="my-12 border-mk-off-black/12" />

        <h2 className="text-3xl font-semibold">Notis privasi Bahasa Malaysia</h2>
        <p className="mt-5 leading-7 text-mk-off-black/72">
          Notis ini menerangkan cara pasukan Mereka dan Biji-biji Initiative yang mengendalikan proses pengambilan rakan
          Oriental Building memproses maklumat melalui laman ini.
        </p>
        <NoticeSection title="Maklumat, tujuan dan pilihan anda">
          <ul>
            <li>Maklumat hubungan dan pertanyaan digunakan supaya pasukan berkaitan boleh menghubungi anda.</li>
            <li>
              Jika anda memilih suara, transkrip dan peristiwa teknikal sesi digunakan untuk penyerahan dan semakan
              kualiti. Laman ini tidak menyimpan audio pelanggan.
            </li>
            <li>
              Peristiwa keselamatan dan penghantaran digunakan untuk mencegah penyalahgunaan serta mendiagnosis
              kegagalan.
            </li>
            <li>
              Kategori interaksi terhad merekod tempat borang dibuka, cara ia dihantar, dan sama ada medan dilengkapkan
              melalui suara, taip, praisi atau gabungan—tanpa menyimpan nilai medan dalam metrik tersebut.
            </li>
            <li>
              Google Analytics hanya diaktifkan selepas anda memilih “Allow analytics”; laluan pentadbir dan rentetan
              pertanyaan tidak dihantar.
            </li>
          </ul>
          <p>
            E-mel diperlukan untuk tindakan susulan. Maklumat lain, penggunaan suara dan analitik adalah pilihan. Anda
            boleh menukar pilihan analitik pada bila-bila masa di atas.
          </p>
        </NoticeSection>
        <NoticeSection title="Pendedahan, penyimpanan dan hak anda">
          <p>
            Akses dihadkan kepada pasukan operasi Mereka/Biji-biji dan pasukan rakan yang ditugaskan. Penyedia
            perkhidmatan yang dinyatakan dalam versi Bahasa Inggeris hanya memproses maklumat yang diperlukan. Rekod
            disimpan untuk tindakan susulan, kualiti, keselamatan dan keperluan undang-undang, kemudian dipadam atau
            dinyahnamakan apabila tidak lagi diperlukan. Anda boleh meminta akses, pembetulan, had pemprosesan atau
            pemadaman melalui <a href={`mailto:${siteMeta.email}`}>{siteMeta.email}</a>.
          </p>
        </NoticeSection>

        <p className="mt-12 text-sm text-mk-off-black/50">Effective 17 July 2026 · Berkuat kuasa 17 Julai 2026</p>
      </article>
    </main>
  );
}

function NoticeSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="mt-10 space-y-4 text-sm leading-7 text-mk-off-black/72 [&_a]:font-semibold [&_a]:text-mk-anchor-blue [&_a]:underline [&_li]:ml-5 [&_li]:list-disc">
      <h2 className="text-xl font-semibold text-mk-off-black">{title}</h2>
      {children}
    </section>
  );
}

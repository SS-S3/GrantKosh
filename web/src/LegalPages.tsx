// Terms, Privacy, Refunds and Contact pages, at /terms, /privacy, /refunds and /contact.
// Payment gateways (Cashfree) require these pages, with the business's contact details, before they
// activate payments. Fill in BUSINESS below; empty fields show as "[to be added]" so gaps are visible.
// These are working drafts, not legal advice: have them reviewed before charging customers.
import type { ReactNode } from "react";

export const BUSINESS = {
  /** Legal name of the business that runs GrantKosh and receives payments. */
  legalName: "Vektor Dynamics",
  /** Support email shown publicly. */
  email: "",
  /** Support phone shown publicly (Cashfree asks for one). */
  phone: "",
  /** Registered address, as on the GST or company registration. */
  address: "",
  /** Grievance Officer under the IT Rules 2021 and the DPDP Act 2023. */
  grievanceOfficer: "",
  /** Courts for disputes, usually the city of the registered office. */
  jurisdiction: "",
};

const UPDATED = "3 November 2026";

export const LEGAL_PAGES = ["terms", "privacy", "refunds", "contact"] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

export function legalPageFromPath(pathname: string): LegalPage | null {
  const last = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  return (LEGAL_PAGES as readonly string[]).includes(last) ? (last as LegalPage) : null;
}

const Fill = ({ v }: { v: string }) => (v ? <>{v}</> : <mark className="todo">[to be added]</mark>);
const Email = () => (BUSINESS.email ? <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> : <Fill v="" />);

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="legal">
      <h1>{title}</h1>
      <p className="legal-updated">Last updated: {UPDATED}</p>
      {children}
    </article>
  );
}

function Terms() {
  return (
    <Page title="Terms of Service">
      <p>
        GrantKosh is run by {BUSINESS.legalName} ("we", "us"). By using GrantKosh, creating an account or subscribing, you agree to these terms. If
        you don't agree, please don't use the service.
      </p>
      <h2>1. What GrantKosh is</h2>
      <p>
        GrantKosh is a directory of grants, government schemes, challenges and investors for founders, with an AI Funding Advisor. We collect
        information about programmes from public pages and summarise it. Programmes change their amounts, rules and dates without notice, and our
        summaries and the Advisor's answers can be wrong or out of date. Always confirm eligibility and details on the official page before
        applying. GrantKosh is not affiliated with any government body or fund, and we don't guarantee that you will receive any funding.
      </p>
      <h2>2. Accounts</h2>
      <p>
        The directory can be used without an account. The Advisor needs an account. Give accurate information, keep your login secure, and tell
        us if you think someone else is using your account. One person, one account.
      </p>
      <h2>3. Free trial</h2>
      <p>
        Accounts that claim the free trial before 25 November 2026 get 30 days of the paid plan's Advisor, within the trial's chat limits. A
        trial needs a verified mobile number and your company's CIN, LLPIN or PAN, and each company and each mobile number can have one trial.
        We may end a trial claimed with false or borrowed details.
      </p>
      <h2>4. Subscription and billing</h2>
      <p>
        The paid plan costs the price shown on the site (₹129 per month at the time of writing, including applicable taxes) and renews every
        month until cancelled. Payments are collected by our payment partner, Cashfree Payments, through UPI AutoPay, card or e-mandate. When
        you set up the mandate, a refundable authorisation charge of ₹1 may be taken. If you subscribe during your trial, the first monthly
        charge is made when the trial ends. Each plan has daily and monthly chat limits, shown on the site; we may change prices or limits with
        at least 7 days' notice before your next renewal. Cancellation and refunds are covered by our <a href="/refunds">Refund and
        Cancellation Policy</a>.
      </p>
      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>copy, scrape, download in bulk or republish the directory, or use automated tools to access it;</li>
        <li>resell or share access to the Advisor, or create accounts to get around trial or usage limits;</li>
        <li>attempt to disrupt, overload, probe or bypass the security of the service;</li>
        <li>send unlawful, harmful or misleading content to the Advisor, or use it to harm others.</li>
      </ul>
      <p>We may limit, suspend or close accounts that break these rules.</p>
      <h2>6. Our content</h2>
      <p>
        The site, its design, our summaries, classifications and compilation of the directory belong to us. Programme names and official
        documents belong to their owners. You may use what you find for your own applications.
      </p>
      <h2>7. AI Advisor</h2>
      <p>
        The Advisor uses a third-party AI model (Google Gemini) to answer questions. Its answers are suggestions, not legal, financial or
        professional advice, and can be wrong. Don't share confidential or personal information in the chat.
      </p>
      <h2>8. Liability</h2>
      <p>
        The service is provided "as is". To the extent the law allows, we are not liable for indirect or consequential losses, or for decisions
        made using the directory or the Advisor. Our total liability to you is limited to the amount you paid us in the 3 months before the
        claim.
      </p>
      <h2>9. Changes and ending</h2>
      <p>
        We may update these terms; the date above shows the latest version, and we'll tell subscribers about material changes by email. You can
        stop using the service and cancel your subscription at any time.
      </p>
      <h2>10. Law and disputes</h2>
      <p>
        These terms are governed by the laws of India. Courts at <Fill v={BUSINESS.jurisdiction} /> have exclusive jurisdiction. Contact us first
        at <Email /> and we'll try to resolve any issue.
      </p>
    </Page>
  );
}

function Privacy() {
  return (
    <Page title="Privacy Policy">
      <p>
        This policy explains what personal data {BUSINESS.legalName} collects through GrantKosh, why, and your rights under the Digital Personal
        Data Protection Act, 2023.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>
          <b>Account:</b> your name, email address and mobile number, through our sign-in provider Clerk.
        </li>
        <li>
          <b>Trial claims:</b> your company's CIN, LLPIN or PAN. We store only a one-way, salted fingerprint (to make sure each company gets one
          trial) and the last 4 characters. We never store the full number.
        </li>
        <li>
          <b>Subscription:</b> your plan, renewal dates and payment status. Card, bank and UPI details are handled by Cashfree Payments; we
          never see or store them.
        </li>
        <li>
          <b>Advisor chats:</b> your questions are sent to Google's Gemini API to generate answers. We don't keep conversations, except that the
          answer to a first question may be kept for up to 6 hours, without your account details, to answer the same question again. Depending on
          the Gemini plan we use, Google may use prompts to improve its products. Don't share confidential or personal information in the chat.
        </li>
        <li>
          <b>Usage and security:</b> IP address, chat counts and request logs, used for rate limits, abuse prevention and fixing problems. Logs
          are kept for up to 30 days; usage counters for up to 60 days.
        </li>
        <li>
          <b>Your browser:</b> we store your theme choice in local storage. We don't use advertising or tracking cookies. Clerk sets cookies
          needed for sign-in.
        </li>
      </ul>
      <h2>Why we use it</h2>
      <p>
        To provide the directory and Advisor, run your account, trial and subscription, prevent abuse, meet legal obligations (such as tax
        records), and contact you about your account. We use your data only for these purposes, on the basis of your consent and our legitimate
        need to run the service.
      </p>
      <h2>Who we share it with</h2>
      <p>
        Only with service providers that run parts of GrantKosh for us: Clerk (sign-in), Cashfree Payments (billing), Google (AI answers),
        Vercel or Oracle Cloud (hosting) and Upstash (usage counters). Some of them process data outside India. We don't sell personal data. We
        disclose data when the law requires it.
      </p>
      <h2>How long we keep it</h2>
      <p>
        Account data is kept while your account is open and deleted within 30 days of closing it, except billing records, which we keep as long
        as tax law requires. Trial fingerprints are kept to prevent repeat trials.
      </p>
      <h2>Your rights</h2>
      <p>
        You can ask to access, correct or delete your personal data, withdraw consent, or nominate someone to act for you, by writing to <Email />
        . You can delete your account from the account menu. If you're not satisfied with our response, you can complain to the Data Protection
        Board of India.
      </p>
      <h2>Grievance Officer</h2>
      <p>
        <Fill v={BUSINESS.grievanceOfficer} />, <Email />. We acknowledge complaints within 24 hours and resolve them within 15 days.
      </p>
      <h2>Changes</h2>
      <p>We'll update this page when our practices change; the date above shows the latest version.</p>
    </Page>
  );
}

function Refunds() {
  return (
    <Page title="Refund and Cancellation Policy">
      <h2>Cancelling</h2>
      <p>
        You can cancel your subscription at any time, and it won't renew. Cancel the GrantKosh mandate in your UPI app (AutoPay / mandates
        section), through your bank or card issuer, or email <Email /> and we'll cancel it for you within 2 working days. After cancelling, you
        keep paid access until the end of the month you've paid for.
      </p>
      <h2>Refunds</h2>
      <ul>
        <li>The ₹1 authorisation charge taken when you set up the mandate is refunded automatically.</li>
        <li>If you were charged twice, or charged after cancelling, we refund the extra charge in full.</li>
        <li>
          If you cancel within 48 hours of a renewal charge and haven't used the Advisor since that charge, we refund that month in full on
          request.
        </li>
        <li>Otherwise, monthly charges are not refunded for partly used months.</li>
      </ul>
      <p>
        Approved refunds are made to the original payment method within 5–7 working days. Your bank may take a few more days to show it. To ask
        for a refund, email <Email /> with the email address of your account and the date of the charge.
      </p>
      <h2>Free trial</h2>
      <p>The free trial costs nothing. If you subscribe during the trial, you are first charged when the trial ends; cancel before then to pay nothing.</p>
    </Page>
  );
}

function Contact() {
  return (
    <Page title="Contact us">
      <dl className="legal-contact">
        <dt>Business</dt>
        <dd>{BUSINESS.legalName}</dd>
        <dt>Email</dt>
        <dd>
          <Email />
        </dd>
        <dt>Phone</dt>
        <dd>
          <Fill v={BUSINESS.phone} />
        </dd>
        <dt>Address</dt>
        <dd>
          <Fill v={BUSINESS.address} />
        </dd>
        <dt>Grievance Officer</dt>
        <dd>
          <Fill v={BUSINESS.grievanceOfficer} />
        </dd>
      </dl>
      <p>We reply to emails within 2 working days.</p>
    </Page>
  );
}

export function LegalPageView({ page }: { page: LegalPage }) {
  return { terms: <Terms />, privacy: <Privacy />, refunds: <Refunds />, contact: <Contact /> }[page];
}

export function LegalLinks() {
  return (
    <nav className="legal-links" aria-label="Policies">
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
      <a href="/refunds">Refunds &amp; cancellation</a>
      <a href="/contact">Contact</a>
    </nav>
  );
}

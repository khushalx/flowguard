import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleX,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  Route,
  Terminal,
  Workflow,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { HeroSculpture } from "@/components/hero-sculpture";
import { LandingNav } from "@/components/landing-nav";
import { Investigation } from "@/components/investigation";
import { loginExample } from "@/lib/landing-demo";
import "./landing.css";

export default function Home() {
  return (
    <div className="landing">
      <a href="#landing-main" className="skip-link">
        Skip to content
      </a>
      <LandingNav />
      <main id="landing-main" className="landing-main">
        <section className="landing-hero landing-container">
          <div className="hero-copy">
            <h1>
              Catch broken deployments{" "}
              <span>
                before your <br />
                users do.
              </span>
            </h1>
            <p className="hero-description">
              Protect critical user journeys with browser tests, deployment
              checks, and clear failure reports.
            </p>
            <div className="hero-actions">
              <Link href="/app" className="button primary">
                Explore FlowGuard
                <ArrowUpRight size={18} />
              </Link>
              <a href="#how-it-works" className="button ghost">
                How it works
                <ArrowRight size={17} />
              </a>
            </div>
            <p className="hero-disclosure">
              Explore the frontend demo. Test execution and integrations are
              being built.
            </p>
          </div>
          <HeroSculpture />
        </section>
        <section id="product" className="product-showcase landing-container">
          <div className="landing-section-heading">
            <div>
              <p className="section-overline">A closer look</p>
              <h2>A failure. The full picture.</h2>
            </div>
            <p>
              See where a journey stopped.
              <br />
              Keep the evidence in the same view.
            </p>
          </div>
          <div className="showcase-window">
            <div className="showcase-chrome">
              <span className="showcase-brand">
                <BrandMark small />
                <span>FlowGuard</span>
              </span>
              <span className="showcase-breadcrumb">
                Acme / Runs / <span className="mono">#1042</span>
              </span>
              <span className="neutral-tag">Interactive sample</span>
            </div>
            <div className="showcase-heading">
              <div>
                <span className="showcase-result">
                  <CircleX size={17} />
                  Run failed
                </span>
                <h3>Sign in to an account</h3>
              </div>
              <span className="showcase-commit mono">
                <GitBranch size={14} />
                fix/auth-redirect
                <GitCommitHorizontal size={15} />
                e72a6c1
              </span>
            </div>
            <Investigation run={loginExample} compact />
          </div>
          <div className="showcase-footnote">
            <p>
              Sample steps, logs, and an illustrative screenshot. No live test
              has run.
            </p>
            <Link className="text-link" href="/app">
              Explore the workspace
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </section>
        <section id="how-it-works" className="how-section landing-container">
          <div className="landing-section-heading">
            <div>
              <p className="section-overline">A simple workflow</p>
              <h2>
                From your project
                <br />
                to the paths that matter.
              </h2>
            </div>
            <p>
              Start with the things your users
              <br />
              should always be able to do.
            </p>
          </div>
          <div className="how-steps">
            <article>
              <span className="how-number mono">01 / Project</span>
              <h3>Connect your project.</h3>
              <p>
                Add a target URL and repository reference. A GitHub connection
                is planned.
              </p>
              <div className="how-visual url-visual">
                <span className="mono">Target URL</span>
                <div>
                  <span className="url-protocol">https://</span>your-app.com
                  <ArrowUpRight size={16} />
                </div>
                <span className="local-caption">
                  <Check size={13} />
                  Local configuration available
                </span>
              </div>
            </article>
            <article>
              <span className="how-number mono">02 / Journey</span>
              <h3>Define critical journeys.</h3>
              <p>
                Describe a workflow and what success looks like. Save and edit
                it locally.
              </p>
              <div className="how-visual journey-visual">
                <div>
                  <Route size={19} />
                  <span>Complete a checkout</span>
                </div>
                <p className="mono">/checkout</p>
                <div className="success-example">
                  <Check size={13} />
                  Order confirmation is visible
                </div>
              </div>
            </article>
            <article>
              <span className="how-number mono">03 / Evidence</span>
              <h3>Inspect the results.</h3>
              <p>
                Explore steps, assertions, screenshots, and logs. Execution
                isn’t connected yet.
              </p>
              <div className="how-visual result-visual">
                <div>
                  <CircleX size={18} />
                  <span>Assertion failed</span>
                  <span className="mono">5.0s</span>
                </div>
                <p>Expected heading wasn’t visible.</p>
                <a className="text-link" href="#product">
                  Inspect the sample
                  <ArrowUpRight size={14} />
                </a>
              </div>
            </article>
          </div>
        </section>
        <section
          className="capabilities-section landing-container"
          id="capabilities"
        >
          <div className="landing-section-heading">
            <div>
              <p className="section-overline">What we’re building</p>
              <h2>
                Less guesswork.
                <br />
                More ground truth.
              </h2>
            </div>
            <p>
              One place for the result and the reason
              <br />
              you can trust it. Here’s where we are.
            </p>
          </div>
          <div className="capabilities-layout">
            <article className="evidence-feature">
              <span className="availability">
                <Check size={14} />
                Available in the demo
              </span>
              <h3>
                Evidence before
                <br />
                explanations.
              </h3>
              <p>
                Inspect the failed step, compare expected and observed states,
                and read the logs. Every explanation starts with what was
                recorded.
              </p>
              <div className="evidence-visual">
                <div>
                  <span>Expected</span>
                  <code>Dashboard is visible</code>
                </div>
                <div>
                  <span>Observed</span>
                  <code>Still on /login</code>
                </div>
                <span className="evidence-visual-caption">
                  <FileTrail />
                  Steps. Screenshot. Logs. Commit.
                </span>
              </div>
              <a className="text-link" href="#product">
                Inspect a failure
                <ArrowRight size={16} />
              </a>
            </article>
            <div className="planned-features">
              <article>
                <div className="planned-feature-title">
                  <Terminal size={20} />
                  <span className="availability planned">Planned</span>
                </div>
                <h3>Real browsers. Real journeys.</h3>
                <p>
                  Playwright-based browser testing for the workflows your users
                  depend on.
                </p>
              </article>
              <article>
                <div className="planned-feature-title">
                  <Workflow size={20} />
                  <span className="availability planned">Planned</span>
                </div>
                <h3>Checks that follow a deployment.</h3>
                <p>
                  Connect test execution to preview deployments and inspect the
                  result before a change reaches users.
                </p>
              </article>
              <article>
                <div className="planned-feature-title">
                  <GitFork size={20} />
                  <span className="availability planned">Planned</span>
                </div>
                <h3>At home in your GitHub workflow.</h3>
                <p>
                  Keep test outcomes beside the pull request and commit that
                  triggered them.
                </p>
              </article>
            </div>
          </div>
        </section>
        <section className="closing-section landing-container">
          <BrandMark />
          <h2>
            Ship changes.
            <br />
            <span>Know what works.</span>
          </h2>
          <Link className="button primary" href="/demo">
            Explore the demo
            <ArrowUpRight size={18} />
          </Link>
          <p>Local workspace. Sample results. No account required.</p>
        </section>
      </main>
      <footer className="landing-footer landing-container">
        <Link className="brand" href="/" aria-label="FlowGuard home">
          <BrandMark small />
          <span>FlowGuard</span>
        </Link>
        <span>Frontend demo · integrations planned</span>
        <a href="#product">Product</a>
        <Link href="/app">
          Workspace
          <ArrowUpRight size={14} />
        </Link>
      </footer>
    </div>
  );
}
function FileTrail() {
  return <GitCommitHorizontal size={15} aria-hidden="true" />;
}

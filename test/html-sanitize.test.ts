import { describe, it, expect } from "vitest";
import { sanitizeEmailHtml } from "@/lib/invoice/html-sanitize";

describe("sanitizeEmailHtml — preserves safe formatting", () => {
  it("keeps common formatting tags and text", () => {
    const out = sanitizeEmailHtml("<p>Hello <b>world</b> &amp; <i>all</i></p>");
    expect(out).toContain("<p>");
    expect(out).toContain("<b>world</b>");
    expect(out).toContain("<i>all</i>");
  });

  it("keeps tables (invoices/statements layout)", () => {
    const out = sanitizeEmailHtml('<table><tr><td align="right" bgcolor="#eee">Total</td><td>₹100</td></tr></table>');
    expect(out).toContain("<table>");
    expect(out).toContain("<td");
    expect(out).toContain('align="right"');
    expect(out).toContain("₹100");
  });

  it("keeps http/https/mailto links and forces target+rel", () => {
    const out = sanitizeEmailHtml('<a href="https://acme.com/inv">View</a> <a href="mailto:ap@x.com">Mail</a>');
    expect(out).toContain('href="https://acme.com/inv"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('href="mailto:ap@x.com"');
  });

  it("keeps external https images", () => {
    const out = sanitizeEmailHtml('<img src="https://acme.com/logo.png" alt="logo" width="80">');
    expect(out).toContain('src="https://acme.com/logo.png"');
    expect(out).toContain('alt="logo"');
  });

  it("keeps a safe subset of inline styles, drops url()/expression()", () => {
    const out = sanitizeEmailHtml('<p style="color:#0a0; font-weight:bold; background:url(javascript:evil()); width:500px">x</p>');
    expect(out).toContain("color:#0a0");
    expect(out).toContain("font-weight:bold");
    expect(out).toContain("width:500px");
    expect(out).not.toContain("url(");
    expect(out).not.toContain("javascript");
  });
});

describe("sanitizeEmailHtml — blocks script injection and unsafe content", () => {
  it("drops <script> and its content", () => {
    const out = sanitizeEmailHtml('before<script>alert(document.cookie)</script>after');
    expect(out).toBe("beforeafter");
    expect(out).not.toContain("alert");
  });

  it("defeats the nested-tag bypass", () => {
    const out = sanitizeEmailHtml('<scr<script>ipt>alert(1)</script>ok');
    expect(out.toLowerCase()).not.toContain("alert");
    expect(out.toLowerCase()).not.toContain("<script");
  });

  it("strips event-handler attributes", () => {
    const out = sanitizeEmailHtml('<img src="https://x/y.png" onerror="steal()"><div onclick="x()">hi</div>');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("steal()");
  });

  it("drops javascript: and vbscript: URLs", () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">x</a><a href="vbscript:msgbox(1)">y</a>');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("vbscript:");
  });

  it("drops <style>, <iframe>, <object>, <embed>, <svg> with content", () => {
    const out = sanitizeEmailHtml(
      '<style>body{background:url(javascript:x)}</style><iframe src="http://evil"></iframe><object data="evil"></object><svg onload="x()"></svg>keep',
    );
    expect(out).toBe("keep");
  });

  it("drops a data:text/html img but keeps data:image", () => {
    const evil = sanitizeEmailHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">');
    expect(evil).not.toContain("data:text/html");
    const ok = sanitizeEmailHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">');
    expect(ok).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("strips HTML comments (incl. IE conditional comments)", () => {
    const out = sanitizeEmailHtml("A<!--[if IE]><script>x()</script><![endif]-->B");
    expect(out).toBe("AB");
  });

  it("unwraps unknown tags but keeps their text", () => {
    const out = sanitizeEmailHtml("<foo>text<bar baz>more</bar></foo>");
    expect(out).toContain("text");
    expect(out).toContain("more");
    expect(out).not.toContain("<foo");
    expect(out).not.toContain("<bar");
  });
});

describe("sanitizeEmailHtml — inline images (cid) handled safely", () => {
  it("resolves cid: to a data URI via the callback", () => {
    const out = sanitizeEmailHtml('<img src="cid:logo123" alt="logo">', {
      resolveCid: (cid) => (cid === "logo123" ? "data:image/png;base64,AAAA" : null),
    });
    expect(out).toContain("data:image/png;base64,AAAA");
    expect(out).not.toContain("cid:");
  });

  it("drops an inline image that cannot be resolved", () => {
    const out = sanitizeEmailHtml('keep<img src="cid:missing">', { resolveCid: () => null });
    expect(out).toBe("keep");
  });
});

describe("sanitizeEmailHtml — entity-encoded bypasses (fail closed)", () => {
  it("blocks entity-encoded javascript: in href (colon, hex, decimal)", () => {
    for (const href of [
      "javascript&#58;alert(1)",       // &#58; = ':'
      "java&#x09;script:alert(1)",      // tab inside scheme
      "&#106;avascript:alert(1)",       // &#106; = 'j'
      "jav&#x61;script:alert(1)",       // &#x61; = 'a'
      "&#74;avaScript:alert(1)",        // &#74; = 'J'
    ]) {
      const out = sanitizeEmailHtml(`<a href="${href}">x</a>`);
      expect(out.toLowerCase(), href).not.toContain("javascript:");
      expect(out.toLowerCase(), href).not.toContain("alert");
    }
  });

  it("blocks entity-encoded vbscript: and keeps the anchor text", () => {
    const out = sanitizeEmailHtml('<a href="vbscript&#58;msgbox(1)">click</a>');
    expect(out).not.toContain("vbscript:");
    expect(out).toContain("click");
  });

  it("round-trips a legitimate URL that contains &amp; / &lt;", () => {
    const out = sanitizeEmailHtml('<a href="https://acme.com/p?a=1&amp;b=2">x</a>');
    expect(out).toContain("acme.com/p?a=1");
    expect(out).toContain('target="_blank"');
  });

  it("blocks CSS property smuggling via an encoded semicolon", () => {
    const out = sanitizeEmailHtml('<p style="color:red&#59;position:fixed;top:0">x</p>');
    expect(out).toContain("color:red");
    expect(out).not.toContain("position:fixed"); // disallowed property smuggled past the allow-list
  });

  it("blocks encoded expression()/behavior in CSS", () => {
    const out = sanitizeEmailHtml('<p style="width:e&#x78;pression(alert(1)); behavior:url(x.htc)">x</p>');
    expect(out.toLowerCase()).not.toContain("expression");
    expect(out.toLowerCase()).not.toContain("behavior");
  });

  it("blocks a CSS-escape that would reconstruct expression() after unescaping", () => {
    const out = sanitizeEmailHtml('<p style="width:ex\\pression(alert(1))">x</p>');
    expect(out.toLowerCase()).not.toContain("expression(");
  });

  it("blocks a backslash-split URL scheme (java\\script:)", () => {
    const out = sanitizeEmailHtml('<a href="java\\script:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(out.toLowerCase()).not.toContain("alert");
  });
});

describe("sanitizeEmailHtml — SVG and data-image hardening", () => {
  it("drops a data:image/svg+xml img (SVG can carry script)", () => {
    const out = sanitizeEmailHtml('<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">');
    expect(out).not.toContain("data:image/svg");
    expect(out).toBe(""); // no usable src -> whole img dropped
  });
  it("keeps a raster data:image/png", () => {
    const out = sanitizeEmailHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">');
    expect(out).toContain("data:image/png;base64,iVBORw0KGgo=");
  });
  it("drops an <svg> block with an onload handler entirely", () => {
    const out = sanitizeEmailHtml('A<svg onload="alert(1)"><rect/></svg>B');
    expect(out).toBe("AB");
  });
});

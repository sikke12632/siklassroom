import type { SVGProps } from "react";

type SchoolIllustrationBaseProps = Omit<
  SVGProps<SVGSVGElement>,
  "aria-hidden" | "aria-label" | "role"
> & {
  /** Use `compact` when the illustration sits in a narrow sidebar. */
  variant?: "banner" | "compact";
};

export type SchoolIllustrationProps = SchoolIllustrationBaseProps &
  (
    | {
        /** Decorative illustrations are hidden from assistive technology by default. */
        decorative?: true;
        title?: never;
      }
    | {
        /** Supply a title when the illustration conveys information. */
        decorative: false;
        title: string;
      }
  );

/**
 * Dependency-free school scene for classroom portal welcome cards and sidebars.
 *
 * Colors can be themed with the `--school-illustration-*` custom properties.
 */
export function SchoolIllustration({
  className,
  decorative = true,
  title,
  variant = "banner",
  ...svgProps
}: SchoolIllustrationProps) {
  const isInformative = decorative === false;

  return (
    <svg
      {...svgProps}
      aria-hidden={isInformative ? undefined : true}
      aria-label={isInformative ? title : undefined}
      className={["school-illustration", className].filter(Boolean).join(" ")}
      data-variant={variant}
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
      role={isInformative ? "img" : "presentation"}
      viewBox={variant === "compact" ? "90 0 340 250" : "0 0 520 250"}
      xmlns="http://www.w3.org/2000/svg"
    >
      {isInformative ? <title>{title}</title> : null}

      <g className="school-illustration__sky-details">
        <circle
          className="school-illustration__sun"
          cx="425"
          cy="46"
          fill="var(--school-illustration-sun, #ffd166)"
          r="22"
        />
        <g
          className="school-illustration__cloud"
          fill="var(--school-illustration-cloud, #ffffff)"
        >
          <path d="M67 70c3-16 26-18 33-5 13-8 31 1 30 17H62c-7-3-5-12 5-12Z" />
          <path d="M383 88c2-12 20-14 25-4 10-7 25 0 24 13h-54c-5-3-4-9 5-9Z" />
        </g>
      </g>

      <path
        className="school-illustration__ground"
        d="M15 224c71-25 133-22 196-7 74 18 147-18 294 5v28H15Z"
        fill="var(--school-illustration-ground, #dcefc9)"
      />

      <g className="school-illustration__trees">
        <g className="school-illustration__tree school-illustration__tree--left">
          <path
            d="M94 140v75"
            stroke="var(--school-illustration-trunk, #9b6b4a)"
            strokeLinecap="round"
            strokeWidth="9"
          />
          <path
            d="M94 90c-17 0-25 16-19 30-18 6-17 34 1 39 5 16 30 18 39 3 19-2 24-28 8-38 8-18-10-36-29-34Z"
            fill="var(--school-illustration-tree, #61b678)"
          />
          <path
            d="m94 129-16-13m16 29 20-17"
            fill="none"
            stroke="var(--school-illustration-tree-detail, #3c8e5d)"
            strokeLinecap="round"
            strokeWidth="4"
          />
        </g>
        <g className="school-illustration__tree school-illustration__tree--right">
          <path
            d="M427 142v73"
            stroke="var(--school-illustration-trunk, #9b6b4a)"
            strokeLinecap="round"
            strokeWidth="9"
          />
          <path
            d="M428 91c-18-1-27 16-20 31-17 7-15 34 3 39 7 17 32 17 40 0 18-4 20-30 4-39 6-17-10-31-27-31Z"
            fill="var(--school-illustration-tree, #61b678)"
          />
          <path
            d="m428 129-16-12m16 29 19-17"
            fill="none"
            stroke="var(--school-illustration-tree-detail, #3c8e5d)"
            strokeLinecap="round"
            strokeWidth="4"
          />
        </g>
      </g>

      <g
        className="school-illustration__building"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="3"
      >
        <path
          className="school-illustration__wing school-illustration__wing--left"
          d="M139 145h75v72h-75Z"
          fill="var(--school-illustration-wall, #fff8e8)"
        />
        <path
          className="school-illustration__wing school-illustration__wing--right"
          d="M306 145h75v72h-75Z"
          fill="var(--school-illustration-wall, #fff8e8)"
        />
        <path
          className="school-illustration__roof school-illustration__roof--left"
          d="m129 145 47-31 48 31Z"
          fill="var(--school-illustration-roof, #3777c8)"
        />
        <path
          className="school-illustration__roof school-illustration__roof--right"
          d="m296 145 47-31 48 31Z"
          fill="var(--school-illustration-roof, #3777c8)"
        />
        <path
          className="school-illustration__main"
          d="M207 113h106v104H207Z"
          fill="var(--school-illustration-wall, #fff8e8)"
        />
        <path
          className="school-illustration__main-roof"
          d="m196 114 64-49 64 49Z"
          fill="var(--school-illustration-roof, #3777c8)"
        />
        <path
          className="school-illustration__flagpole"
          d="M260 65V24"
          fill="none"
          strokeLinecap="round"
        />
        <path
          className="school-illustration__flag"
          d="M261 27c17-10 25 9 42-1v22c-17 10-25-9-42 1Z"
          fill="var(--school-illustration-flag, #ffd166)"
        />
        <circle
          className="school-illustration__clock-face"
          cx="260"
          cy="103"
          fill="var(--school-illustration-clock, #ffffff)"
          r="18"
        />
        <path
          className="school-illustration__clock-hands"
          d="M260 91v13l9 5"
          fill="none"
          strokeLinecap="round"
        />
        <g
          className="school-illustration__windows"
          fill="var(--school-illustration-window, #bde4ff)"
        >
          <path d="M153 161h20v21h-20Zm28 0h20v21h-20Zm-28 31h20v20h-20Zm28 0h20v20h-20Z" />
          <path d="M319 161h20v21h-20Zm28 0h20v21h-20Zm-28 31h20v20h-20Zm28 0h20v20h-20Z" />
          <path d="M223 137h19v22h-19Zm55 0h19v22h-19Z" />
        </g>
        <path
          className="school-illustration__door"
          d="M239 176a21 21 0 0 1 42 0v41h-42Z"
          fill="var(--school-illustration-door, #e9a56f)"
        />
        <path
          className="school-illustration__door-line"
          d="M260 176v41"
          fill="none"
        />
      </g>

      <g
        className="school-illustration__bushes"
        fill="var(--school-illustration-bush, #4ca968)"
      >
        <path d="M101 217c0-15 19-23 30-12 8-17 34-12 35 12Z" />
        <path d="M351 217c1-15 21-22 31-10 9-16 34-9 35 10Z" />
      </g>
    </svg>
  );
}

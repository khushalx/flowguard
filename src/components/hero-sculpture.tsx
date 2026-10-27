"use client";
import { useEffect, useRef } from "react";
import { markPath } from "./brand";

// A small vector extrusion, rather than a WebGL canvas or a rendered image.
// CSS supplies depth and a slow studio turn; pointer movement only updates a transform.
export function HeroSculpture() {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useRef(false);
  useEffect(() => {
    const query = window.matchMedia(
      "(prefers-reduced-motion: no-preference) and (pointer: fine) and (min-width: 801px)",
    );
    const update = () => {
      motion.current = query.matches;
      if (!query.matches) {
        ref.current?.style.removeProperty("--tilt-x");
        ref.current?.style.removeProperty("--tilt-y");
      }
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return (
    <div
      className="brand-sculpture"
      ref={ref}
      aria-hidden="true"
      onPointerMove={(event) => {
        if (!motion.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty(
          "--tilt-x",
          `${((event.clientY - rect.top) / rect.height - 0.5) * -8}deg`,
        );
        event.currentTarget.style.setProperty(
          "--tilt-y",
          `${((event.clientX - rect.left) / rect.width - 0.5) * 10}deg`,
        );
      }}
      onPointerLeave={(event) => {
        event.currentTarget.style.setProperty("--tilt-x", "0deg");
        event.currentTarget.style.setProperty("--tilt-y", "0deg");
      }}
    >
      <div className="sculpture-pointer">
        <div className="sculpture-turn">
          <svg className="metal-emblem" viewBox="-16 -10 150 140" fill="none">
            <defs>
              <linearGradient
                id="metal-front"
                x1="0"
                y1="0"
                x2="105"
                y2="100"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#333333" />
                <stop offset=".23" stopColor="#9c9c9c" />
                <stop offset=".38" stopColor="#e8e8e8" />
                <stop offset=".45" stopColor="#8b8b8b" />
                <stop offset=".57" stopColor="#383838" />
                <stop offset=".8" stopColor="#202020" />
                <stop offset="1" stopColor="#6b6b6b" />
              </linearGradient>
              <linearGradient
                id="metal-cap"
                x1="48"
                y1="8"
                x2="97"
                y2="36"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#fafafa" />
                <stop offset=".27" stopColor="#b4b4b4" />
                <stop offset=".67" stopColor="#363636" />
                <stop offset="1" stopColor="#707070" />
              </linearGradient>
              <linearGradient
                id="metal-side"
                x1="22"
                y1="25"
                x2="109"
                y2="113"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#484848" />
                <stop offset=".35" stopColor="#141414" />
                <stop offset=".68" stopColor="#747474" />
                <stop offset=".8" stopColor="#1e1e1e" />
                <stop offset="1" stopColor="#090909" />
              </linearGradient>
              <linearGradient
                id="metal-edge"
                x1="8"
                y1="10"
                x2="90"
                y2="94"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#fff" />
                <stop offset=".44" stopColor="#777" />
                <stop offset="1" stopColor="#292929" />
              </linearGradient>
            </defs>
            <path
              d={markPath}
              transform="translate(9 15)"
              fill="#121212"
              stroke="#343434"
              strokeWidth=".5"
            />
            <g fill="url(#metal-side)" stroke="#424242" strokeWidth=".25">
              <path d="M106 8 115 23 102 45 93 30Z" />
              <path d="M60 30 93 30 102 45 69 45Z" />
              <path d="M85 46 94 61 81 83 72 68Z" />
              <path d="M37 68 72 68 81 83 46 83Z" />
              <path d="M37 68 46 83 32 107 23 92Z" />
              <path d="M0 92H23L32 107H9Z" />
            </g>
            <path
              d={markPath}
              fill="url(#metal-front)"
              stroke="url(#metal-edge)"
              strokeWidth=".65"
            />
            <path
              d="M48 8H106L93 30H60Z"
              fill="url(#metal-cap)"
              stroke="url(#metal-edge)"
              strokeWidth=".65"
            />
            <path
              d="M33 36H56L50 46H85L72 68H37L0 92Z"
              fill="url(#metal-front)"
            />
            <path
              d="M33 36H56L50 46 37 68 23 92H0Z"
              fill="url(#metal-front)"
              stroke="url(#metal-edge)"
              strokeWidth=".45"
            />
            <path
              d="M33 36H56M50 46H85M37 68H72M60 30H93M0 92H23"
              stroke="#c5c5c5"
              strokeOpacity=".65"
              strokeWidth=".5"
            />
            <path
              d="M34 37H54L48 47H82M50 9H103"
              stroke="#fff"
              strokeOpacity=".45"
              strokeWidth=".3"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

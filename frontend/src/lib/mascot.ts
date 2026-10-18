/**
 * Our mascot. Swap in your own lion here: the portrait photo, the cut-out used in the room
 * (public/room/lion.webp, background removed), the zoo, and the video that opens on right-click.
 */
export const MASCOT = {
  name: "Leon the Lion",
  species: "lion",
  zoo: "", // e.g. "Woodland Park Zoo"
  photo: "/mascot/lion.jpg",
  cutout: "/room/lion.webp",
  /** Fill in if the photo's licence asks for credit; the caption hides it while null. */
  credit: null as null | { author: string; license: string; licenseUrl: string; source: string },
  /** Opened on right-click. Point it at a specific video once we have one. */
  montage: "https://www.youtube.com/results?search_query=lion+montage",
};

export const mascotTitle = () => MASCOT.name || `Our ${MASCOT.species}`;
export const mascotWhere = () => (MASCOT.zoo ? `, ${MASCOT.zoo}` : "");

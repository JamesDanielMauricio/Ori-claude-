import { redirect } from "next/navigation";

// Per the PRD, Customer Home's "Data tab" (tab=data, order entry) is the
// default — note the param meaning is inverted versus Grower Home's.
export default function CustomerIndexPage() {
  redirect("/customer/order");
}

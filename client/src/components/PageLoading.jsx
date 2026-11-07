import { Spinner } from "./ui/spinner";

// In a page's place while its code loads (the pages load when first opened).
function PageLoading() {
    return (
        <div className="flex flex-1 items-center justify-center py-24">
            <Spinner className="size-10" />
        </div>
    )
}

export default PageLoading

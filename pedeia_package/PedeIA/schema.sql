
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;
-- ============================================================
-- PARTE 2
-- MERCHANTS
-- ============================================================

CREATE TABLE public.merchants (
    id UUID PRIMARY KEY
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    name VARCHAR(120) NOT NULL,

    email VARCHAR(190) NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- CUSTOMERS
-- ============================================================

CREATE TABLE public.customers (
    id UUID PRIMARY KEY
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    name VARCHAR(120) NOT NULL,

    email VARCHAR(190) UNIQUE,

    phone VARCHAR(30) NOT NULL,

    address TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- SHOPS
-- ============================================================

CREATE TABLE public.shops (
    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    merchant_id UUID NOT NULL
        REFERENCES public.merchants(id)
        ON DELETE CASCADE,

    public_id VARCHAR(120) NOT NULL UNIQUE,

    name VARCHAR(140) NOT NULL,

    type VARCHAR(80) NOT NULL,

    description TEXT,

    photo_url TEXT,

    is_open BOOLEAN NOT NULL DEFAULT TRUE,

    accepts_delivery BOOLEAN NOT NULL DEFAULT TRUE,

    accepts_pickup BOOLEAN NOT NULL DEFAULT TRUE,

    delivery_minutes SMALLINT NOT NULL DEFAULT 45,

    pickup_minutes SMALLINT NOT NULL DEFAULT 20,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT shops_delivery_minutes_check
        CHECK (delivery_minutes >= 0),

    CONSTRAINT shops_pickup_minutes_check
        CHECK (pickup_minutes >= 0)
);
-- ============================================================
-- PARTE 3
-- CATEGORIES
-- ============================================================

CREATE TABLE public.categories (
    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    shop_id UUID NOT NULL
        REFERENCES public.shops(id)
        ON DELETE CASCADE,

    name VARCHAR(100) NOT NULL,

    sort_order SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT categories_sort_order_check
        CHECK (sort_order >= 0),

    CONSTRAINT shop_category
        UNIQUE (shop_id, name)
);


-- ============================================================
-- PRODUCTS
-- ============================================================

CREATE TABLE public.products (
    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    shop_id UUID NOT NULL
        REFERENCES public.shops(id)
        ON DELETE CASCADE,

    category_id UUID NOT NULL
        REFERENCES public.categories(id)
        ON DELETE RESTRICT,

    name VARCHAR(140) NOT NULL,

    description TEXT NOT NULL,

    photo_url TEXT,

    price NUMERIC(10,2) NOT NULL,

    available BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT products_price_check
        CHECK (price >= 0)
);


-- ============================================================
-- ORDERS
-- ============================================================

CREATE TABLE public.orders (
    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    shop_id UUID NOT NULL
        REFERENCES public.shops(id)
        ON DELETE RESTRICT,

    customer_id UUID NOT NULL
        REFERENCES public.customers(id)
        ON DELETE RESTRICT,

    fulfillment VARCHAR(20) NOT NULL,

    address TEXT,

    payment VARCHAR(40) NOT NULL,

    notes TEXT,

    total NUMERIC(10,2) NOT NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'Aguardando',

    ready_at TIMESTAMPTZ NOT NULL,

    confirmed_at TIMESTAMPTZ NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT orders_fulfillment_check
        CHECK (
            fulfillment IN (
                'delivery',
                'pickup'
            )
        ),

    CONSTRAINT orders_status_check
        CHECK (
            status IN (
                'Aguardando',
                'Em preparo',
                'Pronto',
                'Saiu para entrega',
                'Entregue',
                'Cancelado'
            )
        ),

    CONSTRAINT orders_total_check
        CHECK (total >= 0),

    CONSTRAINT orders_address_delivery_check
        CHECK (
            fulfillment = 'pickup'
            OR address IS NOT NULL
        )
);
-- ============================================================
-- PARTE 4
-- ORDER ITEMS
-- ============================================================

CREATE TABLE public.order_items (
    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL
        REFERENCES public.orders(id)
        ON DELETE CASCADE,

    product_id UUID NOT NULL
        REFERENCES public.products(id)
        ON DELETE RESTRICT,

    product_name VARCHAR(140) NOT NULL,

    product_description TEXT NOT NULL,

    quantity SMALLINT NOT NULL,

    unit_price NUMERIC(10,2) NOT NULL,

    item_note TEXT,

    CONSTRAINT order_items_quantity_check
        CHECK (quantity > 0),

    CONSTRAINT order_items_unit_price_check
        CHECK (unit_price >= 0)
);


-- ============================================================
-- MESSAGES
-- ============================================================

CREATE TABLE public.messages (
    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL
        REFERENCES public.orders(id)
        ON DELETE CASCADE,

    sender_type VARCHAR(20) NOT NULL,

    sender_id UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    message TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT messages_sender_type_check
        CHECK (
            sender_type IN (
                'customer',
                'merchant'
            )
        )
);


-- ============================================================
-- RATINGS
-- ============================================================

CREATE TABLE public.ratings (
    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL UNIQUE
        REFERENCES public.orders(id)
        ON DELETE CASCADE,

    shop_id UUID NOT NULL
        REFERENCES public.shops(id)
        ON DELETE RESTRICT,

    customer_id UUID NOT NULL
        REFERENCES public.customers(id)
        ON DELETE RESTRICT,

    value SMALLINT NOT NULL,

    comment TEXT,

    media_url TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ratings_value_check
        CHECK (
            value BETWEEN 1 AND 5
        )
);
-- ============================================================
-- PARTE 5
-- ÍNDICES
-- ============================================================

CREATE INDEX idx_shops_merchant_id
    ON public.shops(merchant_id);

CREATE INDEX idx_categories_shop_id
    ON public.categories(shop_id);

CREATE INDEX idx_products_shop_id
    ON public.products(shop_id);

CREATE INDEX idx_products_category_id
    ON public.products(category_id);

CREATE INDEX idx_orders_shop_id
    ON public.orders(shop_id);

CREATE INDEX idx_orders_customer_id
    ON public.orders(customer_id);

CREATE INDEX idx_order_items_order_id
    ON public.order_items(order_id);

CREATE INDEX idx_order_items_product_id
    ON public.order_items(product_id);

CREATE INDEX idx_messages_order_id
    ON public.messages(order_id);

CREATE INDEX idx_messages_sender_id
    ON public.messages(sender_id);

CREATE INDEX idx_ratings_shop_id
    ON public.ratings(shop_id);

CREATE INDEX idx_ratings_customer_id
    ON public.ratings(customer_id);


-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE TRIGGER merchants_set_updated_at
BEFORE UPDATE ON public.merchants
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER customers_set_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER shops_set_updated_at
BEFORE UPDATE ON public.shops
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER orders_set_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
